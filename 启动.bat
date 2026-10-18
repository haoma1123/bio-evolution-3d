@echo off
chcp 65001 >nul
cd /d %~dp0
echo ============================================
echo  生物演化 3D 网状图谱 - 本地服务器
echo  关闭本窗口即停止服务
echo ============================================
echo.
python -u tools\serve.py --port 8790
echo.
echo 服务已退出。按任意键关闭窗口。
pause >nul
