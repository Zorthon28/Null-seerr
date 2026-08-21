Write-Host "Starting Production Arr Stack..." -ForegroundColor Green
docker compose -f C:\arr-stack\docker-compose.yml up -d
Write-Host "Production Stack Started! Access Null-seerr at http://localhost:5055 (or https://seerr.nullraccoon.com)" -ForegroundColor Cyan
