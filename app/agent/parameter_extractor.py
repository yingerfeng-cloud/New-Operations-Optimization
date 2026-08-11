from __future__ import annotations

import re
import json
from typing import Any

from app.services.llm_service import llm_service


LOAD_MARKERS = ["\u8d1f\u8377\u662f", "\u8d1f\u8377\u4e3a", "\u8d1f\u8377:", "\u8d1f\u8377\uff1a", "\u8d1f\u8377", "load"]
LOAD_STOP_PATTERNS = [
    r"(?<![A-Za-z0-9])U\d+(?![A-Za-z0-9])",
    "\u673a\u7ec4",
    "\u6700\u5927",
    "\u6210\u672c",
    "\u51fa\u529b",
    "\u5bb9\u91cf",
    "\u4e0a\u9650",
    "\u4e0b\u9650",
]
MAX_KEYWORDS = ["\u6700\u5927", "\u4e0a\u9650", "max"]
COST_KEYWORDS = ["\u6210\u672c", "\u8d39\u7528", "cost"]
# Keywords whose right-adjacent number is the global per-unit max output
GLOBAL_MAX_KEYWORDS = ["\u6700\u5927\u51fa\u529b", "\u51fa\u529b\u4e0a\u9650", "\u4e0a\u9650\u51fa\u529b", "\u6700\u5927\u529f\u7387"]
# Keywords whose right-adjacent number is the global per-unit fuel cost
GLOBAL_COST_KEYWORDS = ["\u71c3\u6599\u6210\u672c", "\u53d1\u7535\u6210\u672c", "\u5355\u4f4d\u6210\u672c"]


class ParameterExtractor:
    def extract(self, message: str, input_schema: list[dict[str, Any]]) -> dict[str, Any]:
        result = self.extract_with_meta(message, input_schema, allow_llm=True)
        return result["parameters"]

    def extract_with_meta(self, message: str, input_schema: list[dict[str, Any]], allow_llm: bool = True) -> dict[str, Any]:
        fallback = self._rule_extract(message, input_schema)
        meta = {"parameters": fallback, "llm_attempted": False, "llm_timeout": False, "fallback_mode": None, "llm_extract_ms": 0}
        if fallback or not allow_llm:
            return meta
        import time

        started = time.perf_counter()
        llm_params, llm_timeout = self._extract_with_llm(message, input_schema)
        meta["llm_extract_ms"] = int((time.perf_counter() - started) * 1000)
        meta["llm_attempted"] = True
        meta["llm_timeout"] = llm_timeout
        meta["fallback_mode"] = "rule_based" if llm_timeout else None
        meta["parameters"] = {**fallback, **llm_params}
        return meta

    def _extract_with_llm(self, message: str, input_schema: list[dict[str, Any]]) -> tuple[dict[str, Any], bool]:
        try:
            data = llm_service.extract_parameters(message, input_schema)
        except Exception:
            return {}, True
        params = data.get("extracted_parameters") if isinstance(data, dict) else {}
        return (params if isinstance(params, dict) else {}, False)

    def _rule_extract(self, message: str, input_schema: list[dict[str, Any]]) -> dict[str, Any]:
        params: dict[str, Any] = {}
        params.update(self._extract_json_object(message, input_schema))
        units = self._units(message)
        load, time_labels = self._extract_load_series(message)
        if load and "load_forecast" not in params and self._schema_item(input_schema, "load_forecast"):
            params["load_forecast"] = self._time_value(input_schema, "load_forecast", load)
            params["horizon"] = len(load)
            if time_labels:
                params["time"] = time_labels

        storage_params = self._extract_storage_dispatch(message, input_schema)
        if storage_params:
            params.update({key: value for key, value in storage_params.items() if key not in params})

        unit_max: dict[str, float] = {}
        fuel_cost: dict[str, float] = {}
        for unit in units:
            max_value, cost_value = self._extract_unit_max_and_cost(message, unit)
            if max_value is not None:
                unit_max[unit] = max_value
            if cost_value is not None:
                fuel_cost[unit] = cost_value
        if unit_max and self._schema_item(input_schema, "unit_max_output"):
            params["unit_max_output"] = unit_max
        if fuel_cost and self._schema_item(input_schema, "fuel_cost"):
            params["fuel_cost"] = fuel_cost

        if units:
            ordered_fields = {
                "unit_min_output": ["机组最小出力", "最小出力", "出力下限"],
                "unit_max_output": ["机组最大出力", "最大出力", "出力上限"],
                "fuel_cost": ["燃料成本", "发电成本", "单位成本"],
                "ramp_up_limit": ["上爬坡限制", "爬坡上限", "最大上爬坡"],
                "ramp_down_limit": ["下爬坡限制", "爬坡下限", "最大下爬坡"],
            }
            for key, labels in ordered_fields.items():
                # Explicit clauses such as "U1...，U2..." are more precise
                # than a positional list.  Never overwrite those values by
                # re-reading unit labels (the digit in U2 is not a value).
                if key in params or not self._schema_item(input_schema, key):
                    continue
                values = self._extract_ordered_values(message, labels, len(units))
                if values:
                    params[key] = {unit: values[index] for index, unit in enumerate(units)}

        # Global-scalar fallback: user said "机组最大出力500" without unit labels.
        # Extract a single scalar; the orchestrator will broadcast it to per-unit dict.
        if "unit_max_output" not in params and self._schema_item(input_schema, "unit_max_output"):
            gmax = self._number_after_keywords(message, GLOBAL_MAX_KEYWORDS)
            if gmax is not None:
                params["unit_max_output"] = gmax
        if "fuel_cost" not in params and self._schema_item(input_schema, "fuel_cost"):
            gcost = self._number_after_keywords(message, GLOBAL_COST_KEYWORDS + COST_KEYWORDS)
            if gcost is not None:
                params["fuel_cost"] = gcost

        return params

    def _extract_json_object(self, message: str, input_schema: list[dict[str, Any]]) -> dict[str, Any]:
        text = str(message or "").strip()
        if not text:
            return {}
        candidates = []
        fence = re.search(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", text, re.IGNORECASE)
        if fence:
            candidates.append(fence.group(1))
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            candidates.append(text[start : end + 1])
        if text.startswith("{") and text.endswith("}"):
            candidates.append(text)
        allowed = {str(item.get("key")) for item in input_schema or [] if item.get("key")}
        for raw in candidates:
            try:
                data = json.loads(raw)
            except Exception:
                continue
            if not isinstance(data, dict):
                continue
            return {key: value for key, value in data.items() if key in allowed}
        return {}

    def _extract_storage_dispatch(self, message: str, input_schema: list[dict[str, Any]]) -> dict[str, Any]:
        keys = {str(item.get("key")) for item in input_schema or []}
        if not {"electricity_price", "storage_capacity", "charge_power_max", "discharge_power_max"} & keys:
            return {}
        text = str(message or "")
        result: dict[str, Any] = {}
        price = self._numbers_after_label(
            text,
            ["电价", "价格", "electricity_price"],
            stop_labels=["储能容量", "容量", "最大充电功率", "最大放电功率", "充放电功率", "功率", "充电效率", "放电效率", "初始SOC", "初始 SOC"],
        )
        if price and "electricity_price" in keys:
            result["electricity_price"] = price
        both_power = self._number_after_storage_label(text, ["充放电功率", "充/放电功率", "充放电最大功率"])
        if both_power is not None:
            if "charge_power_max" in keys:
                result["charge_power_max"] = both_power
            if "discharge_power_max" in keys:
                result["discharge_power_max"] = both_power
        scalar_patterns = [
            ("storage_capacity", ["储能容量", "容量"]),
            ("charge_power_max", ["最大充电功率", "充电功率", "充电上限"]),
            ("discharge_power_max", ["最大放电功率", "放电功率", "放电上限"]),
            ("charge_efficiency", ["充电效率"]),
            ("discharge_efficiency", ["放电效率"]),
            ("initial_soc", ["初始SOC", "初始soc", "初始 SOC", "初始soc", "初始荷电状态"]),
        ]
        for key, labels in scalar_patterns:
            if key not in keys:
                continue
            value = self._value_after_storage_label(text, labels)
            if value is not None:
                result[key] = value
        return result

    def _value_after_storage_label(self, text: str, labels: list[str]) -> float | int | dict[str, float | int] | None:
        for label in labels:
            match = re.search(
                rf"{re.escape(label)}\s*(B\d+)?\s*(?:改成|设为|设置为|调整为|[是为:=：])?\s*([0-9]+(?:\.[0-9]+)?)",
                text,
                re.IGNORECASE,
            )
            if match:
                value = self._num(match.group(2))
                return {match.group(1).upper(): value} if match.group(1) else value
        return None

    def _numbers_after_label(self, text: str, labels: list[str], stop_labels: list[str] | None = None) -> list[float | int]:
        for label in labels:
            match = re.search(rf"{re.escape(label)}\s*[是为:=：]?\s*([\s\S]+)", text, re.IGNORECASE)
            if not match:
                continue
            segment = match.group(1)
            for stop in stop_labels or []:
                stop_match = re.search(re.escape(stop), segment, re.IGNORECASE)
                if stop_match:
                    segment = segment[: stop_match.start()]
            nums = re.findall(r"(?<![A-Za-z])\d+(?:\.\d+)?", segment)
            if nums:
                return [self._num(item) for item in nums]
        return []

    def _number_after_storage_label(self, text: str, labels: list[str]) -> float | int | None:
        for label in labels:
            match = re.search(rf"{re.escape(label)}\s*(?:B\d+)?\s*(?:改成|设为|设置为|调整为|[是为:=：])?\s*([0-9]+(?:\.[0-9]+)?)", text, re.IGNORECASE)
            if match:
                return self._num(match.group(1))
        return None

    def _units(self, message: str) -> list[str]:
        units = sorted(set(re.findall(r"(?<![A-Za-z0-9])U\d+(?![A-Za-z0-9])", message, re.IGNORECASE)), key=lambda item: int(re.findall(r"\d+", item)[0]))
        if units:
            return [unit.upper() for unit in units]
        count_match = re.search(
            r"([0-9]{1,3}|[一二两三四五六七八九十百]+)\s*(?:台|个)\s*(?:发电)?机组",
            str(message or ""),
        )
        if not count_match:
            return []
        count = self._unit_count(count_match.group(1))
        if count is None or not 1 <= count <= 100:
            return []
        return [f"U{index}" for index in range(1, count + 1)]

    @staticmethod
    def _unit_count(value: str) -> int | None:
        if value.isdigit():
            return int(value)
        digits = {"一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}
        if value == "十":
            return 10
        if "百" in value:
            left, _, right = value.partition("百")
            hundreds = digits.get(left, 1) * 100
            remainder = ParameterExtractor._unit_count(right) if right else 0
            return hundreds + remainder if remainder is not None else None
        if "十" in value:
            left, _, right = value.partition("十")
            tens = digits.get(left, 1) * 10
            return tens + digits.get(right, 0)
        return digits.get(value)

    def _extract_load_values(self, message: str) -> list[float]:
        return self._extract_load_series(message)[0]

    def _extract_load_series(self, message: str) -> tuple[list[float | int], list[str]]:
        lowered = message.lower()
        for marker in LOAD_MARKERS:
            pos = lowered.find(marker.lower())
            if pos < 0:
                continue
            segment = message[pos + len(marker) :]
            segment = self._truncate_load_segment(segment)
            pairs = re.findall(
                r"(?<!\d)([01]?\d|2[0-3]):([0-5]\d)(?:\s*(?:→|->|=>|=|为|：)\s*|\s+)(-?\d+(?:\.\d+)?)",
                segment,
            )
            if pairs:
                labels = [f"{int(hour):02d}:{minute}" for hour, minute, _ in pairs]
                return [self._num(value) for _, _, value in pairs], labels
            # Clock components describe the index and must never be counted as
            # forecast values (the former parser turned 24 values into 72+).
            value_segment = re.sub(r"(?<!\d)(?:[01]?\d|2[0-3]):[0-5]\d(?!\d)", " ", segment)
            nums = re.findall(r"(?<![A-Za-z])-?\d+(?:\.\d+)?", value_segment)
            if nums:
                return [self._num(item) for item in nums], []
        return [], []

    def _extract_ordered_values(
        self,
        message: str,
        labels: list[str],
        expected_count: int,
    ) -> list[float | int]:
        all_labels = [
            "机组最小出力", "最小出力", "出力下限", "机组最大出力", "最大出力", "出力上限",
            "燃料成本", "发电成本", "单位成本", "上爬坡限制", "爬坡上限", "最大上爬坡",
            "下爬坡限制", "爬坡下限", "最大下爬坡", "负荷预测", "负荷",
        ]
        for label in labels:
            match = re.search(rf"{re.escape(label)}\s*(?:分别)?\s*(?:为|是|[:：=])?\s*", message, re.IGNORECASE)
            if not match:
                continue
            segment = message[match.end():]
            stop = len(segment)
            for other in all_labels:
                other_match = re.search(re.escape(other), segment, re.IGNORECASE)
                if other_match:
                    stop = min(stop, other_match.start())
            segment = segment[:stop]
            numbers = re.findall(r"-?\d+(?:\.\d+)?", segment)
            if len(numbers) >= expected_count:
                return [self._num(value) for value in numbers[:expected_count]]
        return []

    def _truncate_load_segment(self, segment: str) -> str:
        end = len(segment)
        for pattern in LOAD_STOP_PATTERNS:
            match = re.search(pattern, segment, re.IGNORECASE)
            if match:
                end = min(end, match.start())
        return segment[:end]

    def _extract_unit_max_and_cost(self, message: str, unit: str) -> tuple[float | int | None, float | int | None]:
        for match in re.finditer(re.escape(unit), message, re.IGNORECASE):
            start = match.end()
            next_unit = re.search(r"(?<![A-Za-z0-9])U\d+(?![A-Za-z0-9])", message[start:], re.IGNORECASE)
            end = start + next_unit.start() if next_unit else len(message)
            segment = message[start:end]
            max_value = self._number_after_keywords(segment, GLOBAL_MAX_KEYWORDS + MAX_KEYWORDS)
            cost_value = self._number_after_keywords(segment, GLOBAL_COST_KEYWORDS + COST_KEYWORDS)
            if max_value is not None or cost_value is not None:
                return max_value, cost_value
        return None, None

    def _number_after_keywords(self, text: str, keywords: list[str]) -> float | int | None:
        for keyword in keywords:
            match = re.search(rf"{keyword}\s*([0-9]+(?:\.[0-9]+)?)", text, re.IGNORECASE)
            if match:
                return self._num(match.group(1))
        return None

    def _time_value(self, input_schema: list[dict[str, Any]], key: str, values: list[float]) -> Any:
        item = self._schema_item(input_schema, key) or {}
        sample = item.get("sample_value") or item.get("default_value")
        if str(item.get("type", "")).lower() == "array":
            return values
        if isinstance(sample, dict):
            keys = list(sample.keys())[: len(values)]
        else:
            keys = [f"T{i + 1}" for i in range(len(values))]
        return {str(k): values[i] for i, k in enumerate(keys)}

    def _schema_item(self, input_schema: list[dict[str, Any]], key: str) -> dict[str, Any] | None:
        for item in input_schema:
            if item.get("key") == key:
                return item
        return None

    def _num(self, value: str) -> float | int:
        number = float(value)
        return int(number) if number.is_integer() else number


parameter_extractor = ParameterExtractor()
