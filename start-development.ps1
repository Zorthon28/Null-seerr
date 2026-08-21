Write-Host "Building and Starting Development Arr Stack..." -ForegroundColor Green
docker compose -f C:\arr-stack-dev\docker-compose.yml up -d --build
Write-Host "Development Stack Started! Access Null-seerr-dev at http://localhost:5056" -ForegroundColor Cyan
