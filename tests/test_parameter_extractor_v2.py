from app.agent.parameter_extractor_v2 import ParameterSource, parameter_extractor_v2


SCHEMA = [
    {"key": "electricity_price", "name": "分时电价", "type": "array", "required": True, "dimension": ["time"], "sets": {"time": ["t1", "t2", "t3"]}},
    {"key": "storage_capacity", "name": "储能容量", "type": "number", "required": True},
    {"key": "charge_power_max", "name": "最大充电功率", "type": "number", "required": True},
    {"key": "discharge_power_max", "name": "最大放电功率", "type": "number", "required": True},
]


def test_schema_driven_extraction_tracks_sources_and_shape():
    result = parameter_extractor_v2.extract("储能容量100MWh，充放电功率50MW，电价0.3、0.6、1.1", SCHEMA, allow_llm=False)
    assert result["parameters"]["storage_capacity"] == 100
    assert result["parameters"]["charge_power_max"] == 50
    assert result["parameters"]["discharge_power_max"] == 50
    assert result["parameters"]["electricity_price"] == [0.3, 0.6, 1.1]
    assert set(result["parameter_sources"].values()) == {ParameterSource.RULE_EXTRACTED.value}
    assert not result["invalid_params"]


def test_length_mismatch_is_reported_without_auto_filling():
    result = parameter_extractor_v2.extract("电价0.3、0.6，储能容量100，充放电功率50", SCHEMA, allow_llm=False)
    assert any(item["key"] == "electricity_price" for item in result["invalid_params"])
