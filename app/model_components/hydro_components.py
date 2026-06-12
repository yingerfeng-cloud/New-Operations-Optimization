from __future__ import annotations

from typing import Any

from app.model_components.registry import register_component
from app.model_components.validators import validate_hydro_runtime_parameters


class HydroComponentBase:
    component_type = ""
    display_name = ""
    category = "水电调度"
    description = ""
    formula = ""
    example = ""
    required_parameters: list[str] = []
    common_errors: list[str] = []

    def validate(self, spec: dict[str, Any], context: dict[str, Any]) -> None:
        if not context["metadata"].get("hydro_runtime_validated"):
            validate_hydro_runtime_parameters(context["runtime_parameters"])
            context["metadata"]["hydro_runtime_validated"] = True

    def explain(self) -> dict[str, Any]:
        return {
            "formula": self.formula,
            "example": self.example,
            "required_parameters": list(self.required_parameters),
            "common_errors": list(self.common_errors),
            "sample_spec": {"type": self.component_type},
        }


@register_component("hydro_initial_volume")
class HydroInitialVolumeComponent(HydroComponentBase):
    display_name = "初始库容组件"
    description = "用于指定各水库调度起点库容，是水量平衡递推的初始状态。"
    formula = "volume[s,0] = initial_volume[s]"
    example = "若 S1 初始库容为 120，则调度起点 volume[S1,0] 固定为 120。"
    required_parameters = ["initial_volume"]
    common_errors = ["initial_volume 缺少电站编码", "initial_volume 不在库容上下限范围内"]

    def build(self, model: Any, spec: dict[str, Any], context: dict[str, Any]) -> None:
        import pyomo.environ as pyo

        initial_volume = context["runtime_parameters"]["initial_volume"]
        first_volume_time = _set_values(context, "time_volume")[0]

        def rule(m: Any, station: str) -> Any:
            return m.volume[station, first_volume_time] == float(_lookup(initial_volume, station))

        model.hydro_initial_volume = pyo.Constraint(model.station, rule=rule)
        context["constraints"]["hydro_initial_volume"] = model.hydro_initial_volume


@register_component("hydro_volume_bounds")
class HydroVolumeBoundsComponent(HydroComponentBase):
    display_name = "库容上下限组件"
    description = "用于保证水库运行不突破安全库容边界。"
    formula = "volume_min[s] <= volume[s,t] <= volume_max[s]"
    example = "若 S1 安全库容区间为 80 到 160，则所有时段库容均保持在该区间内。"
    required_parameters = ["volume_min", "volume_max"]
    common_errors = ["volume_min 大于 volume_max", "初始或目标库容不在安全范围内"]

    def build(self, model: Any, spec: dict[str, Any], context: dict[str, Any]) -> None:
        import pyomo.environ as pyo

        volume_min = context["runtime_parameters"]["volume_min"]
        volume_max = context["runtime_parameters"]["volume_max"]

        def rule(m: Any, station: str, t: Any) -> Any:
            return pyo.inequality(float(_lookup(volume_min, station)), m.volume[station, t], float(_lookup(volume_max, station)))

        model.hydro_volume_bounds = pyo.Constraint(model.station, model.time_volume, rule=rule)
        context["constraints"]["hydro_volume_bounds"] = model.hydro_volume_bounds


@register_component("hydro_station_available_capacity")
class HydroStationAvailableCapacityComponent(HydroComponentBase):
    display_name = "检修可用容量组件"
    description = "根据机组检修状态折算电站最大可用出力。"
    formula = "station_pmax[s,t] = sum(unit_pmax[u] * availability[u,t])"
    example = "S1_U2 在 t=1 检修时，S1 的可用容量自动扣除该机组最大出力。"
    required_parameters = ["units", "unit_pmax", "availability"]
    common_errors = ["availability 长度与 horizon 不一致", "unit_pmax 缺少某个机组"]

    def build(self, model: Any, spec: dict[str, Any], context: dict[str, Any]) -> None:
        import pyomo.environ as pyo

        params = context["runtime_parameters"]
        station_pmax: dict[tuple[str, Any], float] = {}
        times = _set_values(context, "time")
        for station in _set_values(context, "station"):
            station_units = list(_lookup(params["units"], station))
            for idx, time_label in enumerate(times):
                station_pmax[(station, time_label)] = sum(
                    float(_lookup(params["unit_pmax"], unit)) * float(_lookup(params["availability"], unit)[idx])
                    for unit in station_units
                )
        context["derived_parameters"]["station_pmax"] = station_pmax

        def rule(m: Any, station: str, t: Any) -> Any:
            return m.station_power[station, t] <= station_pmax[(station, t)]

        model.hydro_station_available_capacity = pyo.Constraint(model.station, model.time, rule=rule)
        context["constraints"]["hydro_station_available_capacity"] = model.hydro_station_available_capacity


@register_component("hydro_power_flow_conversion")
class HydroPowerFlowConversionComponent(HydroComponentBase):
    display_name = "出力-发电流量转换组件"
    description = "第一版采用固定系数 P = k × Qgen 近似水头和效率。"
    formula = "station_power[s,t] = power_conversion[s] * q_gen[s,t]"
    example = "若 S1 转换系数为 0.38，则 263.16 m3/s 发电流量约对应 100 MW 出力。"
    required_parameters = ["power_conversion"]
    common_errors = ["power_conversion 缺少电站编码", "power_conversion 小于等于 0"]

    def build(self, model: Any, spec: dict[str, Any], context: dict[str, Any]) -> None:
        import pyomo.environ as pyo

        power_conversion = context["runtime_parameters"]["power_conversion"]

        def rule(m: Any, station: str, t: Any) -> Any:
            return m.station_power[station, t] == float(_lookup(power_conversion, station)) * m.q_gen[station, t]

        model.hydro_power_flow_conversion = pyo.Constraint(model.station, model.time, rule=rule)
        context["constraints"]["hydro_power_flow_conversion"] = model.hydro_power_flow_conversion


@register_component("hydro_outflow_balance")
class HydroOutflowBalanceComponent(HydroComponentBase):
    display_name = "下泄流量平衡组件"
    description = "电站下泄流量由发电过机流量和弃水流量组成。"
    formula = "q_out[s,t] = q_gen[s,t] + q_spill[s,t]"
    example = "若发电流量为 260 且弃水为 20，则下泄流量为 280。"
    required_parameters = []
    common_errors = ["q_gen、q_spill 或 q_out 变量未在 component_spec 中声明"]

    def build(self, model: Any, spec: dict[str, Any], context: dict[str, Any]) -> None:
        import pyomo.environ as pyo

        def rule(m: Any, station: str, t: Any) -> Any:
            return m.q_out[station, t] == m.q_gen[station, t] + m.q_spill[station, t]

        model.hydro_outflow_balance = pyo.Constraint(model.station, model.time, rule=rule)
        context["constraints"]["hydro_outflow_balance"] = model.hydro_outflow_balance


@register_component("hydro_outflow_bounds")
class HydroOutflowBoundsComponent(HydroComponentBase):
    display_name = "下泄流量上下限组件"
    description = "限制生态、防洪或调度要求的下泄边界。"
    formula = "outflow_min[s] <= q_out[s,t] <= outflow_max[s]"
    example = "S1 生态下泄要求为 80 时，每个时段 q_out[S1,t] 不低于 80。"
    required_parameters = ["outflow_min", "outflow_max"]
    common_errors = ["outflow_min 大于 outflow_max", "下泄边界缺少电站编码"]

    def build(self, model: Any, spec: dict[str, Any], context: dict[str, Any]) -> None:
        import pyomo.environ as pyo

        outflow_min = context["runtime_parameters"]["outflow_min"]
        outflow_max = context["runtime_parameters"]["outflow_max"]

        def rule(m: Any, station: str, t: Any) -> Any:
            return pyo.inequality(float(_lookup(outflow_min, station)), m.q_out[station, t], float(_lookup(outflow_max, station)))

        model.hydro_outflow_bounds = pyo.Constraint(model.station, model.time, rule=rule)
        context["constraints"]["hydro_outflow_bounds"] = model.hydro_outflow_bounds


@register_component("hydro_spill_bounds")
class HydroSpillBoundsComponent(HydroComponentBase):
    display_name = "弃水上限组件"
    description = "限制弃水流量上限。"
    formula = "0 <= q_spill[s,t] <= spill_max[s]"
    example = "若 S1 弃水上限为 500，则 q_spill[S1,t] 不能超过 500。"
    required_parameters = ["spill_max"]
    common_errors = ["spill_max 缺少电站编码", "spill_max 小于 0"]

    def build(self, model: Any, spec: dict[str, Any], context: dict[str, Any]) -> None:
        import pyomo.environ as pyo

        spill_max = context["runtime_parameters"]["spill_max"]

        def rule(m: Any, station: str, t: Any) -> Any:
            return m.q_spill[station, t] <= float(_lookup(spill_max, station))

        model.hydro_spill_bounds = pyo.Constraint(model.station, model.time, rule=rule)
        context["constraints"]["hydro_spill_bounds"] = model.hydro_spill_bounds


@register_component("hydro_cascade_inflow_delay")
class HydroCascadeInflowDelayComponent(HydroComponentBase):
    display_name = "梯级传播时滞入库组件"
    description = "根据上游下泄、传播时滞和区间来水生成下游入库表达式。"
    formula = "inflow[down,t] = local_inflow[down,t] + sum(q_out[up,t-delay])"
    example = "S1 到 S2 时滞为 1 时段，则 S2 在 t=1 的入库包含 S1 在 t=0 的下泄。"
    required_parameters = ["local_inflow", "edges", "initial_upstream_outflow"]
    common_errors = ["initial_upstream_outflow 缺少 up->down", "edge 中电站编码不在 station 中"]

    def build(self, model: Any, spec: dict[str, Any], context: dict[str, Any]) -> None:
        import pyomo.environ as pyo

        params = context["runtime_parameters"]
        times = _set_values(context, "time")
        time_index = {time_label: idx for idx, time_label in enumerate(times)}
        incoming_edges: dict[str, list[dict[str, Any]]] = {station: [] for station in _set_values(context, "station")}
        for edge in params.get("edges", []) or []:
            incoming_edges[str(edge["downstream"])].append(edge)

        def rule(m: Any, station: str, t: Any) -> Any:
            idx = time_index[t]
            expr = float(_lookup(params["local_inflow"], station)[idx])
            for edge in incoming_edges.get(station, []):
                upstream = str(edge["upstream"])
                delay = int(edge.get("delay_periods", 0))
                shifted_idx = idx - delay
                key = f"{upstream}->{edge['downstream']}"
                if shifted_idx < 0:
                    expr += float(_lookup(params["initial_upstream_outflow"], key))
                else:
                    expr += m.q_out[upstream, times[shifted_idx]]
            return expr

        model.hydro_inflow = pyo.Expression(model.station, model.time, rule=rule)
        context["derived_expressions"]["inflow"] = model.hydro_inflow


@register_component("hydro_reservoir_balance")
class HydroReservoirBalanceComponent(HydroComponentBase):
    display_name = "水库水量平衡组件"
    description = "描述库容随入库、下泄变化的时序递推。"
    formula = "volume[s,t+1] = volume[s,t] + (inflow[s,t] - q_out[s,t]) * delta_v"
    example = "15 分钟内入库大于下泄时库容增加，反之库容下降。"
    required_parameters = ["time_step_seconds", "local_inflow"]
    common_errors = ["time_volume 长度不是 horizon + 1", "梯级入库表达式未先构建"]

    def build(self, model: Any, spec: dict[str, Any], context: dict[str, Any]) -> None:
        import pyomo.environ as pyo

        inflow = context["derived_expressions"].get("inflow")
        if inflow is None:
            raise RuntimeError("梯级水电模型参数错误：水库水量平衡组件需要先构建入库表达式。")
        params = context["runtime_parameters"]
        times = _set_values(context, "time")
        time_volume = _set_values(context, "time_volume")
        time_index = {time_label: idx for idx, time_label in enumerate(times)}
        delta_v = float(params.get("delta_v", float(params.get("time_step_seconds", 900)) / 1_000_000))

        def rule(m: Any, station: str, t: Any) -> Any:
            idx = time_index[t]
            current_volume_t = time_volume[idx]
            next_volume_t = time_volume[idx + 1]
            return m.volume[station, next_volume_t] == m.volume[station, current_volume_t] + (
                inflow[station, t] - m.q_out[station, t]
            ) * delta_v

        model.hydro_reservoir_balance = pyo.Constraint(model.station, model.time, rule=rule)
        context["constraints"]["hydro_reservoir_balance"] = model.hydro_reservoir_balance
        context["derived_parameters"]["delta_v"] = delta_v


@register_component("hydro_load_tracking")
class HydroLoadTrackingComponent(HydroComponentBase):
    display_name = "负荷跟踪组件"
    description = "用正负偏差变量表达无法完全跟踪负荷的情况。"
    formula = "sum(station_power[s,t]) + load_dev_pos[t] - load_dev_neg[t] = load_forecast[t]"
    example = "当可用水电出力不足时，load_dev_pos 表示未跟踪到的负荷缺口。"
    required_parameters = ["load_forecast"]
    common_errors = ["load_forecast 长度与 horizon 不一致", "未声明 load_dev_pos 或 load_dev_neg"]

    def build(self, model: Any, spec: dict[str, Any], context: dict[str, Any]) -> None:
        import pyomo.environ as pyo

        load_forecast = list(context["runtime_parameters"]["load_forecast"])
        times = _set_values(context, "time")
        time_index = {time_label: idx for idx, time_label in enumerate(times)}

        def rule(m: Any, t: Any) -> Any:
            idx = time_index[t]
            return (
                sum(m.station_power[station, t] for station in m.station)
                + m.load_dev_pos[t]
                - m.load_dev_neg[t]
                == float(load_forecast[idx])
            )

        model.hydro_load_tracking = pyo.Constraint(model.time, rule=rule)
        context["constraints"]["hydro_load_tracking"] = model.hydro_load_tracking


@register_component("hydro_terminal_volume")
class HydroTerminalVolumeComponent(HydroComponentBase):
    display_name = "期末库容控制组件"
    description = "控制调度结束时库容接近目标值，避免过度消耗水库。"
    formula = "volume[s,H] - target_terminal_volume[s] = terminal_dev_pos[s] - terminal_dev_neg[s]"
    example = "若 S1 目标期末库容为 118，则偏差变量记录实际期末库容与目标的差值。"
    required_parameters = ["target_terminal_volume"]
    common_errors = ["目标期末库容不在安全库容范围内", "未声明终端库容偏差变量"]

    def build(self, model: Any, spec: dict[str, Any], context: dict[str, Any]) -> None:
        import pyomo.environ as pyo

        target = context["runtime_parameters"]["target_terminal_volume"]
        terminal_t = _set_values(context, "time_volume")[-1]

        def rule(m: Any, station: str) -> Any:
            return (
                m.volume[station, terminal_t]
                - float(_lookup(target, station))
                == m.terminal_dev_pos[station]
                - m.terminal_dev_neg[station]
            )

        model.hydro_terminal_volume = pyo.Constraint(model.station, rule=rule)
        context["constraints"]["hydro_terminal_volume"] = model.hydro_terminal_volume


@register_component("hydro_ramp_smoothing")
class HydroRampSmoothingComponent(HydroComponentBase):
    display_name = "出力平滑组件"
    description = "减少相邻时段出力剧烈变化。"
    formula = "ramp_abs[s,t] >= |station_power[s,t] - station_power[s,t-1]|"
    example = "S1 相邻两个 15 分钟时段出力变化越大，目标函数中的平滑惩罚越大。"
    required_parameters = []
    common_errors = ["未声明 ramp_abs 变量", "time 集合为空"]

    def build(self, model: Any, spec: dict[str, Any], context: dict[str, Any]) -> None:
        import pyomo.environ as pyo

        times = _set_values(context, "time")
        first_time = times[0]
        previous_time = {time_label: times[idx - 1] for idx, time_label in enumerate(times) if idx > 0}

        def up_rule(m: Any, station: str, t: Any) -> Any:
            if t == first_time:
                return pyo.Constraint.Skip
            return m.ramp_abs[station, t] >= m.station_power[station, t] - m.station_power[station, previous_time[t]]

        def down_rule(m: Any, station: str, t: Any) -> Any:
            if t == first_time:
                return pyo.Constraint.Skip
            return m.ramp_abs[station, t] >= m.station_power[station, previous_time[t]] - m.station_power[station, t]

        model.hydro_ramp_smoothing_up = pyo.Constraint(model.station, model.time, rule=up_rule)
        model.hydro_ramp_smoothing_down = pyo.Constraint(model.station, model.time, rule=down_rule)
        context["constraints"]["hydro_ramp_smoothing_up"] = model.hydro_ramp_smoothing_up
        context["constraints"]["hydro_ramp_smoothing_down"] = model.hydro_ramp_smoothing_down


def _set_values(context: dict[str, Any], name: str) -> list[Any]:
    return list(context["sets"].get(name) or [])


def _lookup(data: dict[Any, Any], key: Any) -> Any:
    if key in data:
        return data[key]
    return data[str(key)]
