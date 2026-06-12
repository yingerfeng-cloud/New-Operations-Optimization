from __future__ import annotations

from typing import Any


def validate_hydro_runtime_parameters(params: dict[str, Any]) -> None:
    prefix = "梯级水电模型参数错误："
    stations = _list(params.get("station"))
    if not stations:
        raise RuntimeError(prefix + "station 不能为空。")
    horizon = params.get("horizon")
    if not isinstance(horizon, int) or horizon <= 0:
        raise RuntimeError(prefix + "horizon 必须为正整数。")
    if not params.get("time"):
        params["time"] = list(range(horizon))
    if not params.get("time_volume"):
        params["time_volume"] = list(range(horizon + 1))

    time = _list(params.get("time"))
    time_volume = _list(params.get("time_volume"))
    if len(time) != horizon:
        raise RuntimeError(prefix + f"time 长度为 {len(time)}，但 horizon 为 {horizon}。")
    if len(time_volume) != horizon + 1:
        raise RuntimeError(prefix + f"time_volume 长度为 {len(time_volume)}，但 horizon + 1 为 {horizon + 1}。")

    units = _dict(params.get("units"), "units", prefix)
    unit_pmax = _dict(params.get("unit_pmax"), "unit_pmax", prefix)
    availability = _dict(params.get("availability"), "availability", prefix)
    power_conversion = _dict(params.get("power_conversion"), "power_conversion", prefix)
    local_inflow = _dict(params.get("local_inflow"), "local_inflow", prefix)
    volume_min = _dict(params.get("volume_min"), "volume_min", prefix)
    volume_max = _dict(params.get("volume_max"), "volume_max", prefix)
    initial_volume = _dict(params.get("initial_volume"), "initial_volume", prefix)
    target_terminal_volume = _dict(params.get("target_terminal_volume"), "target_terminal_volume", prefix)
    outflow_min = _dict(params.get("outflow_min"), "outflow_min", prefix)
    outflow_max = _dict(params.get("outflow_max"), "outflow_max", prefix)
    spill_max = _dict(params.get("spill_max"), "spill_max", prefix)
    initial_upstream_outflow = _dict(params.get("initial_upstream_outflow"), "initial_upstream_outflow", prefix)

    load_forecast = _list(params.get("load_forecast"))
    if len(load_forecast) != horizon:
        raise RuntimeError(prefix + f"load_forecast 长度为 {len(load_forecast)}，但 horizon 为 {horizon}。")

    for station in stations:
        station_units = _list(units.get(station, units.get(str(station))))
        if not station_units:
            raise RuntimeError(prefix + f"电站 {station} 至少需要配置一个机组。")
        for unit in station_units:
            if unit not in unit_pmax:
                raise RuntimeError(prefix + f"unit_pmax 缺少机组 {unit}。")
            if unit not in availability:
                raise RuntimeError(prefix + f"availability 缺少机组 {unit}。")
            values = _list(availability[unit])
            if len(values) != horizon:
                raise RuntimeError(prefix + f"机组 {unit} 的 availability 长度为 {len(values)}，但 horizon 为 {horizon}。")
        for field, data in (
            ("power_conversion", power_conversion),
            ("local_inflow", local_inflow),
            ("volume_min", volume_min),
            ("volume_max", volume_max),
            ("initial_volume", initial_volume),
            ("target_terminal_volume", target_terminal_volume),
            ("outflow_min", outflow_min),
            ("outflow_max", outflow_max),
            ("spill_max", spill_max),
        ):
            if station not in data and str(station) not in data:
                raise RuntimeError(prefix + f"{field} 缺少电站 {station}。")
        if float(_get(power_conversion, station)) <= 0:
            raise RuntimeError(prefix + f"电站 {station} 的 power_conversion 必须大于 0。")
        inflow = _list(_get(local_inflow, station))
        if len(inflow) != horizon:
            raise RuntimeError(prefix + f"电站 {station} 的 local_inflow 长度为 {len(inflow)}，但 horizon 为 {horizon}。")
        v_min = float(_get(volume_min, station))
        v_max = float(_get(volume_max, station))
        init = float(_get(initial_volume, station))
        target = float(_get(target_terminal_volume, station))
        if v_min > v_max:
            raise RuntimeError(prefix + f"电站 {station} 的 volume_min 大于 volume_max。")
        if not v_min <= init <= v_max:
            raise RuntimeError(prefix + f"电站 {station} 的 initial_volume 不在 volume_min 与 volume_max 之间。")
        if not v_min <= target <= v_max:
            raise RuntimeError(prefix + f"电站 {station} 的 target_terminal_volume 不在 volume_min 与 volume_max 之间。")
        if float(_get(outflow_min, station)) > float(_get(outflow_max, station)):
            raise RuntimeError(prefix + f"电站 {station} 的 outflow_min 大于 outflow_max。")
        if float(_get(spill_max, station)) < 0:
            raise RuntimeError(prefix + f"电站 {station} 的 spill_max 必须大于等于 0。")

    station_set = set(map(str, stations))
    for edge in _list(params.get("edges")):
        if not isinstance(edge, dict):
            raise RuntimeError(prefix + "edges 中每条边必须是对象。")
        upstream = str(edge.get("upstream", ""))
        downstream = str(edge.get("downstream", ""))
        if upstream not in station_set or downstream not in station_set:
            raise RuntimeError(prefix + f"edge {upstream}->{downstream} 的 upstream/downstream 必须在 station 中。")
        delay = edge.get("delay_periods", 0)
        if not isinstance(delay, int) or delay < 0:
            raise RuntimeError(prefix + f"edge {upstream}->{downstream} 的 delay_periods 必须为非负整数。")
        key = f"{upstream}->{downstream}"
        if key not in initial_upstream_outflow:
            raise RuntimeError(prefix + f"initial_upstream_outflow 缺少 {key}。")


def _dict(value: Any, field: str, prefix: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise RuntimeError(prefix + f"{field} 必须为字典。")
    return value


def _list(value: Any) -> list[Any]:
    return list(value) if isinstance(value, (list, tuple)) else []


def _get(data: dict[str, Any], key: Any) -> Any:
    return data.get(key, data.get(str(key)))
