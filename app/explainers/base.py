from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


ADVISORY_DISCLAIMER = (
    "本结果仅用于辅助分析和决策参考，不构成自动控制指令。实际生产调度、交易申报或安全生产处置"
    "需结合现场规程、业务审批和人工复核后执行。"
)


class BaseExplainer(ABC):
    @abstractmethod
    def explain(self, evidence_package: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError
