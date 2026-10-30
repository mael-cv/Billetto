param(
  [string]$DockerUser = ""
)

$ErrorActionPreference = "Stop"

if (-not $DockerUser) {
  if (Test-Path .env) {
    $envContent = Get-Content .env
    foreach ($line in $envContent) {
      if ($line -match "^DOCKER_USER=(.*)$") {
        $DockerUser = $matches[1].Trim()
      }
    }
  }
}

if (-not $DockerUser -or $DockerUser -eq "monpseudo") {
  $DockerUser = Read-Host "Entrez votre nom d'utilisateur Docker Hub (ex: litmaaa)"
}

if (-not $DockerUser) {
  Write-Error "Nom d'utilisateur Docker Hub obligatoire."
  exit 1
}

Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "📦 Publication des images Billetto sur Docker Hub" -ForegroundColor Cyan
Write-Host "   Compte Docker Hub : $DockerUser" -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan

$initImage = "${DockerUser}/billetto-init:latest"
$apiImage  = "${DockerUser}/billetto-api:latest"
$webImage  = "${DockerUser}/billetto-web:latest"

Write-Host "`n[1/3] Construction de l'image d'initialisation ($initImage)..." -ForegroundColor Yellow
docker build --target init -t $initImage .
if ($LASTEXITCODE -ne 0) { throw "Échec du build de l'image init" }

Write-Host "`n[2/3] Construction de l'image API ($apiImage)..." -ForegroundColor Yellow
docker build --target api -t $apiImage .
if ($LASTEXITCODE -ne 0) { throw "Échec du build de l'image api" }

Write-Host "`n[3/3] Construction de l'image Web ($webImage)..." -ForegroundColor Yellow
docker build --target web -t $webImage .
if ($LASTEXITCODE -ne 0) { throw "Échec du build de l'image web" }

Write-Host "`n📤 Push des images vers Docker Hub..." -ForegroundColor Yellow
docker push $initImage
docker push $apiImage
docker push $webImage

Write-Host "`n====================================================" -ForegroundColor Green
Write-Host "✓ Les images sont en ligne sur Docker Hub :" -ForegroundColor Green
Write-Host "  - $initImage" -ForegroundColor Green
Write-Host "  - $apiImage" -ForegroundColor Green
Write-Host "  - $webImage" -ForegroundColor Green
Write-Host "====================================================" -ForegroundColor Green
Write-Host "`nFichiers à remettre au professeur :" -ForegroundColor Cyan
Write-Host "  1. docker-compose.yml" -ForegroundColor White
Write-Host "  2. .env (contenant DOCKER_USER=$DockerUser)" -ForegroundColor White
Write-Host "`nCommande pour le professeur : docker compose up -d" -ForegroundColor Green
