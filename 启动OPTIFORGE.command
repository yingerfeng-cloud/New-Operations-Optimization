#!/bin/bash

cd "$(dirname "$0")" || exit 1

./start.sh
exit_code=$?

echo
if [ "$exit_code" -eq 0 ]; then
  echo "OPTIFORGE 已启动。浏览器地址：http://127.0.0.1:5173"
else
  echo "OPTIFORGE 启动失败，请查看上面的错误信息。"
fi
read -n 1 -s -r -p "按任意键关闭此窗口..."
echo
exit "$exit_code"
