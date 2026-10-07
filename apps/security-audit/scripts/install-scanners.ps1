#Requires -Version 5.1
<#
.SYNOPSIS
  Installe les scanners externes OPTIONNELS utilisés par @billetto/security-audit.

.DESCRIPTION
  Idempotent : chaque outil déjà présent (dans le PATH) est laissé tel quel.
  Les outils manquants sont installés via winget en priorité, avec un repli
  (pip / go) quand c'est pertinent. Le script NE S'ARRÊTE JAMAIS en erreur si
  un outil ne peut pas être installé : les scanners sont optionnels côté audit
  (ceux restés absents apparaîtront simplement « NOT_INSTALLED » dans le rapport).

  Périmètre : les 5 scanners légers. ZAP (Java, lourd) est volontairement exclu.

.NOTES
  - nuclei télécharge ses templates au premier lancement (connexion requise).
  - semgrep sous Windows natif est limité ; le repli pip est fourni, sinon
    l'exécuter via WSL/Docker. L'audit le tolère s'il reste absent.
#>

$ErrorActionPreference = 'Continue'

function Test-Tool { param([string]$Bin) return [bool](Get-Command $Bin -ErrorAction SilentlyContinue) }
function Test-Cmd  { param([string]$Bin) return [bool](Get-Command $Bin -ErrorAction SilentlyContinue) }

# bin = nom de l'exécutable à détecter (ce que `where` cherche, comme l'audit).
# winget = id winget (ou $null) ; fallback = scriptblock de repli (ou $null).
$Scanners = @(
  @{ name = 'trivy';       bin = 'trivy';       winget = 'AquaSecurity.Trivy';         fallback = { if (Test-Cmd go) { go install github.com/aquasecurity/trivy/cmd/trivy@latest } } }
  @{ name = 'gitleaks';    bin = 'gitleaks';    winget = 'Gitleaks.Gitleaks';          fallback = { if (Test-Cmd go) { go install github.com/gitleaks/gitleaks/v8@latest } } }
  @{ name = 'osv-scanner'; bin = 'osv-scanner'; winget = 'Google.OSVScanner';           fallback = { if (Test-Cmd go) { go install github.com/google/osv-scanner/cmd/osv-scanner@latest } } }
  @{ name = 'nuclei';      bin = 'nuclei';      winget = 'ProjectDiscovery.Nuclei';    fallback = { if (Test-Cmd go) { go install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest } } }
  @{ name = 'semgrep';     bin = 'semgrep';     winget = $null;                         fallback = { if (Test-Cmd pip) { pip install --user semgrep } elseif (Test-Cmd pip3) { pip3 install --user semgrep } } }
)

$hasWinget = Test-Cmd winget
if (-not $hasWinget) { Write-Host "winget introuvable : repli pip/go uniquement." -ForegroundColor Yellow }

$results = @()
foreach ($s in $Scanners) {
  if (Test-Tool $s.bin) {
    Write-Host ("[=] {0} : deja present" -f $s.name) -ForegroundColor DarkGray
    $results += [pscustomobject]@{ Scanner = $s.name; Etat = 'deja present' }
    continue
  }

  Write-Host ("[+] {0} : installation..." -f $s.name) -ForegroundColor Cyan
  if ($hasWinget -and $s.winget) {
    try {
      winget install --id $s.winget --exact --silent --accept-source-agreements --accept-package-agreements --disable-interactivity | Out-Null
    } catch { Write-Host ("    winget a echoue pour {0} : {1}" -f $s.name, $_.Exception.Message) -ForegroundColor Yellow }
  }

  # Repli si toujours absent.
  if (-not (Test-Tool $s.bin) -and $s.fallback) {
    try { & $s.fallback } catch { Write-Host ("    repli a echoue pour {0} : {1}" -f $s.name, $_.Exception.Message) -ForegroundColor Yellow }
  }

  if (Test-Tool $s.bin) {
    Write-Host ("[OK] {0} installe" -f $s.name) -ForegroundColor Green
    $results += [pscustomobject]@{ Scanner = $s.name; Etat = 'installe' }
  } else {
    Write-Host ("[!!] {0} NON installe (optionnel : restera NOT_INSTALLED)" -f $s.name) -ForegroundColor Red
    $results += [pscustomobject]@{ Scanner = $s.name; Etat = 'absent (manuel requis)' }
  }
}

Write-Host ""
Write-Host "=== Recapitulatif scanners ===" -ForegroundColor White
$results | Format-Table -AutoSize

# Rappel : si un PATH vient d'etre mis a jour par winget, rouvrir le terminal.
if ($results | Where-Object { $_.Etat -eq 'installe' }) {
  Write-Host "Astuce : si un scanner n'est pas detecte, rouvrez le terminal (PATH mis a jour)." -ForegroundColor DarkGray
}

# Toujours sortir 0 : les scanners sont optionnels.
exit 0
