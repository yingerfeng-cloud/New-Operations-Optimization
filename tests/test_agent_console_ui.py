from __future__ import annotations

import re
from pathlib import Path


def _html() -> str:
    return Path("agent_console.html").read_text(encoding="utf-8")


def test_agent_console_has_three_column_layout() -> None:
    html = _html()
    # Three-column workbench structure
    assert 'id="wbody"' in html
    assert 'id="sidebar"' in html
    assert 'id="app"' in html
    assert 'id="taskPanel"' in html
    # Render functions for each column
    assert "renderSidebar" in html
    assert "renderChat" in html
    assert "renderTaskPanel" in html
    # CSS grid with panel variant
    assert "with-panel" in html
    assert "workbench-body" in html


def test_agent_console_has_top_status_bar() -> None:
    html = _html()
    assert 'id="topbar"' in html
    assert "renderTopBar" in html
    assert "华电安全生产运筹优化 Agent 工作台" in html
    # Status pills rendered in top bar
    assert "Agent 在线" in html
    assert "平台可达" in html
    assert "LLM 已启用" in html
    # API base input in topbar
    assert 'id="apiBase"' in html


def test_agent_console_has_task_panel() -> None:
    html = _html()
    assert 'id="taskPanel"' in html
    assert "renderTaskPanel" in html
    assert "task-panel" in html
    assert "task-panel-head" in html
    assert "task-panel-body" in html
    assert "task-section" in html
    assert "任务状态" in html


def test_agent_console_renders_required_parameters_card() -> None:
    html = _html()
    assert "cardRequiredParameters" in html
    # Card uses inputSchemaTable which renders required_parameters
    assert "inputSchemaTable" in html
    assert "参数 key" in html
    assert "必填" in html


def test_agent_console_renders_parameter_example_card() -> None:
    html = _html()
    assert "cardParameterExample" in html
    assert "parameter_example" in html
    assert "参数示例" in html
    assert "复制 JSON" in html


def test_agent_console_renders_default_confirmation_card() -> None:
    html = _html()
    assert "cardDefaultConfirmation" in html
    assert "可使用默认值的参数" in html
    assert "确认使用默认值" in html


def test_agent_console_renders_invoke_result_card() -> None:
    html = _html()
    assert "cardInvokeResult" in html
    assert "objective_value" in html
    assert "求解结果" in html
    assert "查看解释" in html


def test_agent_console_no_duplicate_core_functions() -> None:
    html = _html()
    core_fns = [
        "analyzeMessage",
        "confirmDefaults",
        "invokeCurrentTask",
        "explainCurrentResult",
        "renderChat",
        "renderTaskPanel",
        "renderSidebar",
        "renderTopBar",
        "workflowCard",
        "compactResultInMessage",
        "formatExplanationResponse",
    ]
    for fn in core_fns:
        count = len(re.findall(rf"function {fn}\b", html))
        assert count == 1, f"function {fn} defined {count} times (expected exactly 1)"


def test_agent_console_scenario_shortcuts() -> None:
    html = _html()
    assert "SCENARIOS" in html
    assert "经济调度" in html
    assert "储能调度" in html
    assert "梯级水电" in html
    assert "startScenario" in html
    assert "scenario-btn" in html


def test_agent_console_welcome_card() -> None:
    html = _html()
    assert "welcome-card" in html
    assert "我要做经济调度" in html
    assert "给我储能调度参数示例" in html


def test_agent_console_structured_message_cards() -> None:
    html = _html()
    assert "renderMessageCard" in html
    assert "cardAnalysis" in html
    assert "cardReadyToInvoke" in html
    assert "cardResultExplanation" in html


def test_agent_console_platform_unavailable_banner() -> None:
    html = _html()
    assert "platform-banner" in html
    assert "重新检测平台连接" in html
    assert "暂不能调用优化模型" in html


def test_agent_console_debug_panel_collapsed() -> None:
    html = _html()
    # Debug info must exist but hidden behind devMode flag
    assert "debugPanel" in html
    assert "开发调试" in html
    assert "devMode" in html
    # lastRequest/lastResponse in debug
    assert "lastRequest" in html
    assert "lastResponse" in html
