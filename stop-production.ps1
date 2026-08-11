Write-Host "Stopping Production Arr Stack..." -ForegroundColor Yellow
docker compose -f C:\arr-stack\docker-compose.yml down
Write-Host "Production Stack Stopped." -ForegroundColor Green
