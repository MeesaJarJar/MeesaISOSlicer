@echo off
echo Starting server on port 8080...
echo Access locally:  http://localhost:8080
echo Access from LAN:  http://<your-ip>:8080
echo.
echo Press Ctrl+C to stop.
echo.
python -m http.server 8080 --bind 0.0.0.0
pause
