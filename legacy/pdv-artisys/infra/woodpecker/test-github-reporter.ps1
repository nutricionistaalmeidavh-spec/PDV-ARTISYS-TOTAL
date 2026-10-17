param(
  [string]$TokenFile = 'C:\ProgramData\ArtiSys\github-report-token.txt',
  [string]$Repository = 'nutricionistaalmeidavh-spec/PDV-ARTISYS',
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $TokenFile)) {
  throw "Token do reporter nao encontrado em $TokenFile"
}

$token = (Get-Content $TokenFile -Raw).Trim()
if ([string]::IsNullOrWhiteSpace($token)) {
  throw 'Arquivo de token existe, mas esta vazio.'
}

$sha = (& git -C $RepoRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($sha)) {
  throw 'Nao foi possivel determinar o commit atual do repositorio.'
}

$headers = @{
  Accept = 'application/vnd.github+json'
  Authorization = "Bearer $token"
  'X-GitHub-Api-Version' = '2022-11-28'
  'User-Agent' = 'artisys-woodpecker-reporter-self-test'
}

Write-Host "[Reporter Self-Test] Repo: $Repository"
Write-Host "[Reporter Self-Test] Commit: $sha"

# 0. Confirma a identidade autenticada sem revelar o token.
try {
  $identity = Invoke-RestMethod -Method Get -Uri 'https://api.github.com/user' -Headers $headers
  Write-Host "[Reporter Self-Test] Token autenticado como: $($identity.login)"
} catch {
  Write-Host '[Reporter Self-Test] FALHA: o token nao autenticou no GitHub.' -ForegroundColor Red
  throw
}

# 1. Confirma que o token enxerga o repositorio.
try {
  Invoke-RestMethod -Method Get -Uri "https://api.github.com/repos/$Repository" -Headers $headers | Out-Null
  Write-Host '[Reporter Self-Test] Acesso ao repositorio: OK'
} catch {
  $statusCode = $null
  try { $statusCode = [int]$_.Exception.Response.StatusCode } catch {}

  if ($statusCode -eq 404) {
    Write-Host "[Reporter Self-Test] FALHA: o token autenticou como '$($identity.login)', mas nao enxerga '$Repository'." -ForegroundColor Red
    Write-Host '[Reporter Self-Test] Isso normalmente significa que o Fine-grained PAT foi criado com Resource owner incorreto ou sem este repositorio em Repository access.' -ForegroundColor Yellow
    Write-Host '[Reporter Self-Test] No GitHub, edite/recrie o PAT e confira:' -ForegroundColor Yellow
    Write-Host '  Resource owner: nutricionistaalmeidavh-spec'
    Write-Host '  Repository access: All repositories (ou incluir explicitamente PDV-ARTISYS)'
    Write-Host '  Repository permissions: Contents=Read, Commit statuses=Read and write'

    try {
      $visibleRepos = Invoke-RestMethod -Method Get -Uri 'https://api.github.com/user/repos?per_page=100&sort=updated' -Headers $headers
      $names = @($visibleRepos | ForEach-Object { $_.full_name })
      Write-Host "[Reporter Self-Test] Repositorios visiveis por este PAT: $($names.Count)"
      if ($names.Count -gt 0) {
        $sample = ($names | Select-Object -First 10) -join ', '
        Write-Host "[Reporter Self-Test] Amostra: $sample"
      }
    } catch {
      Write-Host '[Reporter Self-Test] Nao foi possivel listar os repositorios visiveis pelo PAT.' -ForegroundColor Yellow
    }

    exit 2
  }

  throw
}

# 2. Confirma Commit statuses: write. O status fica como evidencia auditavel do teste.
$statusBody = @{
  state = 'success'
  context = 'ci/woodpecker/reporter-auth-check'
  description = 'GitHub reporter token validated'
  target_url = 'https://ci.artisys.dev'
} | ConvertTo-Json
try {
  Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$Repository/statuses/$sha" -Headers $headers -ContentType 'application/json' -Body $statusBody | Out-Null
  Write-Host '[Reporter Self-Test] Commit statuses: WRITE OK'
} catch {
  Write-Host '[Reporter Self-Test] FALHA em Commit statuses. Configure Commit statuses = Read and write no Fine-grained PAT.' -ForegroundColor Red
  throw
}

# 3. Confirma criacao de comentario em commit.
$commentBody = @{
  body = "<!-- artisys-reporter-auth-check -->`nArtiSys Woodpecker reporter: token e permissoes basicas validados para ``$($sha.Substring(0,12))``."
} | ConvertTo-Json
try {
  Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$Repository/commits/$sha/comments" -Headers $headers -ContentType 'application/json' -Body $commentBody | Out-Null
  Write-Host '[Reporter Self-Test] Commit comment: WRITE OK'
} catch {
  Write-Host '[Reporter Self-Test] FALHA no comentario de commit. Confira Contents = Read no Fine-grained PAT.' -ForegroundColor Red
  throw
}

Write-Host '[Reporter Self-Test] RESULTADO: OK - token valido para status detalhado + comentario no commit.'
Write-Host '[Reporter Self-Test] Pull requests: write e opcional; serve apenas para duplicar o diagnostico no PR.'
