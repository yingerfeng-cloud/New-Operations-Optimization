#!/bin/bash

cd "$(dirname "$0")" || exit 1

./stop.sh
exit_code=$?

echo
if [ "$exit_code" -eq 0 ]; then
  echo "OPTIFORGE 服务已停止。"
else
  echo "OPTIFORGE 停止时出现问题，请查看上面的错误信息。"
fi
read -n 1 -s -r -p "按任意键关闭此窗口..."
echo
exit "$exit_code"
