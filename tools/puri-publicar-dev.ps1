# Publica a Puri de TESTE (Edge Function "assistente-dev") pela CLI oficial do Supabase.
# Uso: powershell -ExecutionPolicy Bypass -File tools\puri-publicar-dev.ps1
# NUNCA publica a "assistente" (producao). Nome da funcao e projeto sao fixos de proposito.
# O token vem da variavel de USUARIO SUPABASE_ACCESS_TOKEN (nunca e impresso nem gravado).

$ErrorActionPreference = 'Stop'

$ProjetoRef = 'zqadfktfplrbrjmepllh'
$NomeFixo   = 'assistente-dev'
$CliVersao  = 'supabase@3.2.0'
$Arquivos   = @('index.ts', 'logica.ts', 'fatos.ts', 'prompts.ts')

$raiz = Split-Path -Parent $PSScriptRoot
$origem = Join-Path $raiz 'supabase\functions\assistente'

# 1. Trava de ramo e de modificacao da Edge
Push-Location $raiz
try {
    $ramo = (git branch --show-current)
    if ($LASTEXITCODE -ne 0) { throw "git branch falhou (codigo $LASTEXITCODE); trava de ramo nao pode ser verificada." }
    $ramo = "$ramo".Trim()
    if ($ramo -ne 'reforma-puri') { throw "Ramo atual '$ramo'; so publico a partir de 'reforma-puri'." }
    $sujo = git status --porcelain -- supabase/functions/assistente
    if ($LASTEXITCODE -ne 0) { throw "git status falhou (codigo $LASTEXITCODE); trava de modificacao nao pode ser verificada." }
    if ($sujo) { throw "Ha modificacao nao commitada em supabase/functions/assistente:`n$sujo" }
} finally { Pop-Location }

# 2. Token do escopo de usuario (so confere formato)
$token = [Environment]::GetEnvironmentVariable('SUPABASE_ACCESS_TOKEN', 'User')
if (-not $token -or -not $token.StartsWith('sbp_')) {
    throw "Variavel de usuario SUPABASE_ACCESS_TOKEN ausente ou fora do formato sbp_."
}
$env:SUPABASE_ACCESS_TOKEN = $token

# 3. Pasta temporaria
$tmp = Join-Path $env:TEMP ("puri-dev-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
$pubDir = Join-Path $tmp 'pub'
$dlDir  = Join-Path $tmp 'dl'
$fnDir  = Join-Path $pubDir "supabase\functions\$NomeFixo"
New-Item -ItemType Directory -Force -Path $fnDir, (Join-Path $dlDir 'supabase') | Out-Null

try {
    foreach ($a in $Arquivos) {
        $src = Join-Path $origem $a
        if (-not (Test-Path $src)) { throw "Arquivo ausente: $src" }
        Copy-Item $src (Join-Path $fnDir $a)
    }
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    $cfg = "project_id = `"$ProjetoRef`"`n`n[functions.$NomeFixo]`nverify_jwt = true`n"
    [IO.File]::WriteAllText((Join-Path $pubDir 'supabase\config.toml'), $cfg, $utf8)
    [IO.File]::WriteAllText((Join-Path $dlDir 'supabase\config.toml'), "project_id = `"$ProjetoRef`"`n", $utf8)

    # 4. Publica (nome fixo; nunca sem nome)
    Write-Host "Publicando $NomeFixo ..."
    & npx --yes $CliVersao functions deploy $NomeFixo --remote=$ProjetoRef --use-api --yes --workdir $pubDir
    if ($LASTEXITCODE -ne 0) { throw "Falha ao publicar (codigo $LASTEXITCODE)." }

    # 5. Baixa de volta e compara sha256
    Write-Host "Baixando de volta para conferir ..."
    & npx --yes $CliVersao functions download $NomeFixo --remote=$ProjetoRef --use-api --workdir $dlDir
    if ($LASTEXITCODE -ne 0) { throw "Falha ao baixar (codigo $LASTEXITCODE)." }

    $baixado = Join-Path $dlDir "supabase\functions\$NomeFixo"
    $divergiu = $false
    foreach ($a in $Arquivos) {
        $f = Join-Path $baixado $a
        if (-not (Test-Path $f)) { Write-Host "$a : AUSENTE no baixado"; $divergiu = $true; continue }
        $h1 = (Get-FileHash (Join-Path $origem $a) -Algorithm SHA256).Hash
        $h2 = (Get-FileHash $f -Algorithm SHA256).Hash
        if ($h1 -eq $h2) { Write-Host "$a : OK ($($h1.Substring(0,12)))" }
        else { Write-Host "$a : DIFERENTE (disco $($h1.Substring(0,12)) x publicado $($h2.Substring(0,12)))"; $divergiu = $true }
    }
    if ($divergiu) { throw "Conferencia falhou: publicado difere do disco." }
    Write-Host "Conferencia OK: $NomeFixo publicado igual ao disco."
} finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    Remove-Item Env:SUPABASE_ACCESS_TOKEN -ErrorAction SilentlyContinue
}
