Write-Host "Stopping Development Arr Stack..." -ForegroundColor Yellow
docker compose -f C:\arr-stack-dev\docker-compose.yml down
Write-Host "Development Stack Stopped." -ForegroundColor Green
