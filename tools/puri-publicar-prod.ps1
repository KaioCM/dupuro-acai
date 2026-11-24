# Publica a Puri de PRODUCAO (Edge Function "assistente") com trava, backup, fumaca e volta.
# Uso (um modo por vez):
#   powershell -ExecutionPolicy Bypass -File tools\puri-publicar-prod.ps1 -SoBackup
#   powershell -ExecutionPolicy Bypass -File tools\puri-publicar-prod.ps1 -Publicar -Confirmo PUBLICAR
#   powershell -ExecutionPolicy Bypass -File tools\puri-publicar-prod.ps1 -Simular
#   powershell -ExecutionPolicy Bypass -File tools\puri-publicar-prod.ps1 -Fumaca [-Alvo prod|dev]
#   powershell -ExecutionPolicy Bypass -File tools\puri-publicar-prod.ps1 -Voltar <pasta-do-backup> -Confirmo VOLTAR
# O token vem so da variavel de USUARIO SUPABASE_ACCESS_TOKEN (nunca e impresso, gravado nem passado como argumento).
# Funcao, projeto e CLI sao fixos de proposito. Arquivo mantido em ASCII puro.

param(
    [switch]$SoBackup,
    [switch]$Publicar,
    [switch]$Simular,
    [switch]$Fumaca,
    [ValidateSet('prod', 'dev')][string]$Alvo = 'prod',
    [string]$Voltar,
    [string]$Confirmo
)

$ErrorActionPreference = 'Stop'

$ProjetoRef = 'zqadfktfplrbrjmepllh'
$NomeProd   = 'assistente'
$NomeDev    = 'assistente-dev'
$CliVersao  = 'supabase@3.2.0'
$Arquivos   = @('index.ts', 'logica.ts', 'fatos.ts', 'prompts.ts')

$raiz   = Split-Path -Parent $PSScriptRoot
$origem = Join-Path $raiz 'supabase\functions\assistente'
$utf8   = New-Object System.Text.UTF8Encoding($false)
$pastaBackups = Join-Path $env:LOCALAPPDATA 'dupuro-puri-backup'
$cmdSelf = "powershell -ExecutionPolicy Bypass -File `"$PSCommandPath`""
$script:LimiteVisto = $false
$script:FalhaNaoLimite = $false

function Mostrar-Ajuda {
    Write-Host 'Puri de producao: publicar com trava, backup, fumaca e volta.'
    Write-Host ''
    Write-Host 'Modos (exatamente um):'
    Write-Host '  -SoBackup                          baixa a assistente viva para %LOCALAPPDATA%\dupuro-puri-backup\<data-hora>-v<versao>\'
    Write-Host '  -Publicar -Confirmo PUBLICAR       backup, testes, confere com o dev, publica, confere e roda a fumaca'
    Write-Host '  -Simular                           faz resumo, backup, testes e confere com o dev; para ANTES de publicar'
    Write-Host '  -Fumaca [-Alvo prod|dev]           chama a Edge (padrao prod): catalogo, abertura social, uma duvida'
    Write-Host '  -Voltar <pasta> -Confirmo VOLTAR   republica o conteudo de um backup na assistente e roda so o catalogo'
    Write-Host ''
    Write-Host 'Sem -Confirmo correto, os modos que publicam saem com erro sem tocar em nada.'
}

function Obter-Token {
    $t = [Environment]::GetEnvironmentVariable('SUPABASE_ACCESS_TOKEN', 'User')
    if (-not $t -or -not $t.StartsWith('sbp_')) {
        throw 'Variavel de usuario SUPABASE_ACCESS_TOKEN ausente ou fora do formato sbp_.'
    }
    return $t
}

function Hash-Arquivo($caminho) {
    return (Get-FileHash -LiteralPath $caminho -Algorithm SHA256).Hash.ToLower()
}

# Versao e verify_jwt da funcao viva (API de gestao; o token vai so no cabecalho, nunca impresso)
function Obter-InfoFuncao($nome) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $h = @{ Authorization = ('Bearer ' + (Obter-Token)) }
    try {
        $r = Invoke-RestMethod -Method Get -Uri "https://api.supabase.com/v1/projects/$ProjetoRef/functions/$nome" -Headers $h -UserAgent 'dupuro-puri-tools'
    } catch {
        throw "Nao consegui ler a funcao $nome na API de gestao (status/erro de rede)."
    }
    return [pscustomobject]@{ Versao = [int]$r.version; VerifyJwt = [bool]$r.verify_jwt; Status = "$($r.status)" }
}

# Baixa a funcao viva para uma pasta temporaria nova; devolve o caminho da pasta com os arquivos
function Baixar-Funcao($nome, $tmp) {
    $dl = Join-Path $tmp ('dl-' + $nome + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Force -Path (Join-Path $dl 'supabase') | Out-Null
    [IO.File]::WriteAllText((Join-Path $dl 'supabase\config.toml'), "project_id = `"$ProjetoRef`"`n", $utf8)
    $env:SUPABASE_ACCESS_TOKEN = Obter-Token
    & npx --yes $CliVersao functions download $nome --remote=$ProjetoRef --use-api --workdir $dl | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "Falha ao baixar $nome (codigo $LASTEXITCODE)." }
    return (Join-Path $dl "supabase\functions\$nome")
}

function Listar-Arquivos($pasta) {
    $base = (Resolve-Path -LiteralPath $pasta).Path.TrimEnd('\')
    $lista = @()
    foreach ($f in (Get-ChildItem -LiteralPath $base -Recurse -File)) {
        $rel = $f.FullName.Substring($base.Length + 1)
        $lista += [pscustomobject]@{ Rel = $rel; Caminho = $f.FullName; Bytes = $f.Length; Sha = (Hash-Arquivo $f.FullName) }
    }
    return $lista
}

# -SoBackup: devolve o caminho da pasta do backup
function Fazer-Backup($tmp) {
    Write-Host "Backup: lendo versao viva de $NomeProd ..."
    $info = Obter-InfoFuncao $NomeProd
    Write-Host "Versao viva: v$($info.Versao) (verify_jwt=$($info.VerifyJwt))"
    $baixado = Baixar-Funcao $NomeProd $tmp
    if (-not (Test-Path -LiteralPath $baixado)) { throw 'Backup recusado: nada foi baixado.' }
    $arqs = @(Listar-Arquivos $baixado)
    if ($arqs.Count -eq 0) { throw 'Backup recusado: download vazio.' }
    if (-not ($arqs | Where-Object { $_.Rel -eq 'index.ts' })) { throw 'Backup recusado: index.ts nao veio no download.' }
    foreach ($a in $arqs) { if ($a.Bytes -le 0) { throw "Backup recusado: arquivo vazio ($($a.Rel))." } }

    $agora = Get-Date
    $dest = Join-Path $pastaBackups ($agora.ToString('yyyyMMdd-HHmmss') + '-v' + $info.Versao)
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    foreach ($a in $arqs) {
        $alvoArq = Join-Path $dest $a.Rel
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $alvoArq) | Out-Null
        Copy-Item -LiteralPath $a.Caminho -Destination $alvoArq
    }
    $lista = @()
    foreach ($a in $arqs) { $lista += [ordered]@{ caminho = ($a.Rel -replace '\\', '/'); sha256 = $a.Sha; bytes = $a.Bytes } }
    $man = [ordered]@{
        funcao     = $NomeProd
        projeto    = $ProjetoRef
        versao     = $info.Versao
        data       = $agora.ToString('yyyy-MM-ddTHH:mm:sszzz')
        verify_jwt = $info.VerifyJwt
        arquivos   = $lista
    }
    [IO.File]::WriteAllText((Join-Path $dest 'manifesto.json'), ($man | ConvertTo-Json -Depth 6), $utf8)
    Write-Host "Backup OK: $dest"
    Write-Host "  versao v$($info.Versao), $($arqs.Count) arquivo(s):"
    foreach ($a in $arqs) { Write-Host ("  {0}  {1}  {2} bytes" -f $a.Sha.Substring(0, 12), $a.Rel, $a.Bytes) }
    return $dest
}

# Publica uma lista de arquivos (pasta + nomes relativos) como a funcao de producao
function Publicar-Producao($pastaFonte, $arquivosRel, $verifyJwt, $tmp) {
    $pub = Join-Path $tmp ('pub-' + [guid]::NewGuid().ToString('N').Substring(0, 6))
    $fnDir = Join-Path $pub "supabase\functions\$NomeProd"
    New-Item -ItemType Directory -Force -Path $fnDir | Out-Null
    foreach ($rel in $arquivosRel) {
        $d = Join-Path $fnDir $rel
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $d) | Out-Null
        Copy-Item -LiteralPath (Join-Path $pastaFonte $rel) -Destination $d
    }
    $vj = if ($verifyJwt) { 'true' } else { 'false' }
    $cfg = "project_id = `"$ProjetoRef`"`n`n[functions.$NomeProd]`nverify_jwt = $vj`n"
    [IO.File]::WriteAllText((Join-Path $pub 'supabase\config.toml'), $cfg, $utf8)
    $env:SUPABASE_ACCESS_TOKEN = Obter-Token
    Write-Host "Publicando $NomeProd ..."
    & npx --yes $CliVersao functions deploy $NomeProd --remote=$ProjetoRef --use-api --yes --workdir $pub | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "Falha ao publicar $NomeProd (codigo $LASTEXITCODE)." }
}

# Compara arquivos de uma pasta de referencia com a pasta baixada; devolve $true se todos iguais
function Conferir-Hashes($pastaRef, $arquivosRel, $pastaBaixada, $rotulo) {
    $ok = $true
    foreach ($rel in $arquivosRel) {
        $f = Join-Path $pastaBaixada $rel
        if (-not (Test-Path -LiteralPath $f)) { Write-Host "  $rel : AUSENTE em $rotulo"; $ok = $false; continue }
        $h1 = Hash-Arquivo (Join-Path $pastaRef $rel)
        $h2 = Hash-Arquivo $f
        if ($h1 -eq $h2) { Write-Host "  $rel : OK ($($h1.Substring(0, 12)))" }
        else { Write-Host "  $rel : DIFERENTE (esperado $($h1.Substring(0, 12)) x $rotulo $($h2.Substring(0, 12)))"; $ok = $false }
    }
    return $ok
}

# A lista de arquivos baixados tem de ser EXATAMENTE a esperada (sem sobra, sem falta)
function Conferir-ListaExata($pastaBaixada, $arquivosRel, $rotulo) {
    $esp = @($arquivosRel | ForEach-Object { ($_ -replace '/', '\').ToLowerInvariant() } | Sort-Object)
    $tem = @(Listar-Arquivos $pastaBaixada | ForEach-Object { $_.Rel.ToLowerInvariant() } | Sort-Object)
    $sobra = @($tem | Where-Object { $esp -notcontains $_ })
    $falta = @($esp | Where-Object { $tem -notcontains $_ })
    if ($sobra.Count -gt 0 -or $falta.Count -gt 0) {
        $m = "Lista de arquivos em $rotulo nao e a esperada."
        if ($sobra.Count -gt 0) { $m += " Sobrando: $($sobra -join ', ')." }
        if ($falta.Count -gt 0) { $m += " Faltando: $($falta -join ', ')." }
        throw $m
    }
}

# ---------- Fumaca ----------

function Sem-Acento($s) {
    if ($null -eq $s) { return '' }
    $d = ("$s").Normalize([Text.NormalizationForm]::FormD)
    $sb = New-Object Text.StringBuilder
    foreach ($c in $d.ToCharArray()) {
        if ([Globalization.CharUnicodeInfo]::GetUnicodeCategory($c) -ne [Globalization.UnicodeCategory]::NonSpacingMark) { [void]$sb.Append($c) }
    }
    return $sb.ToString().ToLowerInvariant()
}

function Ler-ConfigPublica {
    $cfg = Join-Path $raiz 'assets\js\supabase-config.js'
    $txt = [IO.File]::ReadAllText($cfg, $utf8)
    $mu = [regex]::Match($txt, "DUPURO_SUPABASE_URL\s*=\s*'([^']+)'")
    $mk = [regex]::Match($txt, "DUPURO_SUPABASE_ANON_KEY\s*=\s*'([^']+)'")
    if (-not $mu.Success -or -not $mk.Success) { throw 'Nao achei URL/chave publica em assets/js/supabase-config.js.' }
    return [pscustomobject]@{ Url = $mu.Groups[1].Value.TrimEnd('/'); Chave = $mk.Groups[1].Value }
}

# Chama a Edge e devolve o JSON (ou $null). UTF-8 na resposta; nao imprime chave.
function Chamar-Edge($cfg, $nome, $corpo) {
    Add-Type -AssemblyName System.Net.Http
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $cli = New-Object System.Net.Http.HttpClient
    $cli.Timeout = [TimeSpan]::FromSeconds(60)
    try {
        $req = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Post, ($cfg.Url + '/functions/v1/' + $nome))
        $req.Headers.Add('apikey', $cfg.Chave)
        $req.Headers.Add('Authorization', ('Bearer ' + $cfg.Chave))
        $json = $corpo | ConvertTo-Json -Compress
        $req.Content = New-Object System.Net.Http.StringContent($json, $utf8, 'application/json')
        $resp = $cli.SendAsync($req).Result
        $bytes = $resp.Content.ReadAsByteArrayAsync().Result
        $txt = $utf8.GetString($bytes)
        try { return ($txt | ConvertFrom-Json) } catch { return $null }
    } catch {
        return $null
    } finally { $cli.Dispose() }
}

function Item-Fumaca($nome, $ok, $detalhe) {
    if ($ok) { Write-Host "  PASSOU  $nome" }
    else {
        Write-Host "  FALHOU  $nome ($detalhe)"
        if ("$detalhe" -match 'limite_') { $script:LimiteVisto = $true } else { $script:FalhaNaoLimite = $true }
    }
    return [bool]$ok
}

# Devolve $true se tudo passou
function Rodar-Fumaca($alvo, $soCatalogo) {
    $nome = if ($alvo -eq 'dev') { $NomeDev } else { $NomeProd }
    Write-Host "Fumaca em $nome (soCatalogo=$soCatalogo) ..."
    $cfg = Ler-ConfigPublica
    $tudo = $true
    $script:LimiteVisto = $false
    $script:FalhaNaoLimite = $false

    # 1. catalogo (ate 2 tentativas, 5 s entre elas)
    $c = $null
    for ($t = 1; $t -le 2; $t++) {
        $c = Chamar-Edge $cfg $nome @{ acao = 'catalogo' }
        if ($null -ne $c -and $c.ok -eq $true) { break }
        if ($t -lt 2) { Write-Host '  catalogo sem ok; nova tentativa em 5 s ...'; Start-Sleep -Seconds 5 }
    }
    if ($null -eq $c -or $c.ok -ne $true) {
        $mc = if ($c) { "motivo=$($c.motivo)" } else { 'sem resposta ok' }
        $tudo = (Item-Fumaca 'catalogo ok' $false $mc) -and $tudo
    }
    else {
        $tudo = (Item-Fumaca 'catalogo ok' $true '') -and $tudo
        if (-not $soCatalogo) {
            $min = $c.minimo
            $minOk = ($null -ne $min) -and (($min -is [int]) -or ($min -is [long]) -or ($min -is [double]) -or ($min -is [decimal])) -and ($min -gt 0)
            $tudo = (Item-Fumaca 'catalogo minimo numerico > 0' $minOk 'minimo ausente, nulo ou nao numerico') -and $tudo
        }
        $atOk = ($null -ne $c.atacado)
        $tudo = (Item-Fumaca 'catalogo atacado presente' $atOk 'atacado ausente') -and $tudo
    }
    if ($soCatalogo) { return $tudo }

    # 2. iniciar + abertura social + duvida (uma conversa)
    $ini = Chamar-Edge $cfg $nome @{ acao = 'iniciar'; pagina = 'home' }
    if ($null -eq $ini -or $ini.ok -ne $true -or -not $ini.token) {
        $mot = if ($ini) { "motivo=$($ini.motivo)" } else { 'sem resposta' }
        $tudo = (Item-Fumaca 'iniciar conversa' $false $mot) -and $tudo
        return $false
    }
    $tudo = (Item-Fumaca 'iniciar conversa' $true '') -and $tudo
    $tok = $ini.token

    $ab = Chamar-Edge $cfg $nome @{ acao = 'mensagem'; token = $tok; etapa = 'abertura'; texto = 'ola' }
    $abOk = ($null -ne $ab) -and ($ab.ok -eq $true) -and ($ab.tipo -eq 'intencao') -and ($ab.intencao -eq 'social')
    $tudo = (Item-Fumaca 'abertura "ola" -> intencao social' $abOk $(if ($ab) { "tipo=$($ab.tipo) intencao=$($ab.intencao) motivo=$($ab.motivo)" } else { 'sem resposta' })) -and $tudo
    $abTxt = Sem-Acento $(if ($ab) { $ab.texto } else { '' })
    $tudo = (Item-Fumaca 'abertura "ola" -> texto com "Oi, tudo bem"' ($abTxt.Contains('oi, tudo bem')) 'texto sem a saudacao') -and $tudo

    $du = Chamar-Edge $cfg $nome @{ acao = 'mensagem'; token = $tok; etapa = 'duvida'; texto = 'voces abrem domingo?' }
    $duOk = ($null -ne $du) -and ($du.ok -eq $true) -and ($du.tipo -eq 'resposta')
    $tudo = (Item-Fumaca 'duvida domingo -> tipo resposta' $duOk $(if ($du) { "tipo=$($du.tipo) motivo=$($du.motivo)" } else { 'sem resposta' })) -and $tudo
    $duTxt = Sem-Acento $(if ($du) { $du.texto } else { '' })
    $tudo = (Item-Fumaca 'duvida domingo -> texto nao vazio' ($duTxt.Trim().Length -gt 0) 'texto vazio') -and $tudo
    $tudo = (Item-Fumaca 'duvida domingo -> menciona domingo/nao abre' ($duTxt -match 'domingo|nao abre|nao abrimos|nao funciona|fechad') 'sem mencao a domingo') -and $tudo
    $tudo = (Item-Fumaca 'duvida domingo -> sem "R$" inventado' (-not $duTxt.Contains('r$')) 'texto traz valor em reais') -and $tudo
    return $tudo
}

# Fumaca que falhou so por limite de uso (limite_*) nao e falha de codigo
function Fumaca-Inconclusiva { return ($script:LimiteVisto -and -not $script:FalhaNaoLimite) }

# ---------- Despacho ----------

$modos = 0
if ($SoBackup) { $modos++ }
if ($Publicar) { $modos++ }
if ($Simular) { $modos++ }
if ($Fumaca) { $modos++ }
if ($Voltar) { $modos++ }

if ($modos -eq 0) { Mostrar-Ajuda; exit 0 }
if ($modos -gt 1) { Write-Host 'ERRO: use exatamente um modo (-SoBackup, -Publicar, -Simular, -Fumaca ou -Voltar).'; exit 2 }

# Palavras exatas: sem elas, sai sem tocar em nada
if ($Publicar -and $Confirmo -cne 'PUBLICAR') { Write-Host 'ERRO: -Publicar exige -Confirmo PUBLICAR (palavra exata). Nada foi feito.'; exit 2 }
if ($Voltar -and $Confirmo -cne 'VOLTAR') { Write-Host 'ERRO: -Voltar exige -Confirmo VOLTAR (palavra exata). Nada foi feito.'; exit 2 }

$tmp = Join-Path $env:TEMP ('puri-prod-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$codigo = 0
$pastaBackup = $null

try {
    if ($Fumaca) {
        $ok = Rodar-Fumaca $Alvo $false
        if ($ok) { Write-Host 'FUMACA: PASSOU' }
        elseif (Fumaca-Inconclusiva) { Write-Host 'FUMACA: INCONCLUSIVO por limite (limite_*). Nao e falha de codigo; tente de novo mais tarde.'; $codigo = 3 }
        else { Write-Host 'FUMACA: FALHOU'; $codigo = 1 }
    }
    elseif ($SoBackup) {
        [void](Fazer-Backup $tmp)
    }
    elseif ($Publicar -or $Simular) {
        # 1. Trava de ramo e de modificacao
        Push-Location $raiz
        try {
            $ramo = "$(git branch --show-current)".Trim()
            if ($LASTEXITCODE -ne 0) { throw 'git branch falhou; trava de ramo nao pode ser verificada.' }
            if ($ramo -ne 'reforma-puri' -and $ramo -ne 'main') { throw "Ramo atual '$ramo'; so publico de 'reforma-puri' ou 'main'." }
            $sujo = git status --porcelain -- supabase/functions/assistente
            if ($LASTEXITCODE -ne 0) { throw 'git status falhou; trava de modificacao nao pode ser verificada.' }
            if ($sujo) { throw "Ha modificacao nao commitada em supabase/functions/assistente:`n$sujo" }
            $null = git rev-parse -q --verify MERGE_HEAD
            if ($LASTEXITCODE -eq 0) { throw 'Merge em andamento (MERGE_HEAD); conclua ou aborte antes de publicar.' }
            $null = git rev-parse -q --verify REBASE_HEAD
            if ($LASTEXITCODE -eq 0) { throw 'Rebase em andamento (REBASE_HEAD); conclua ou aborte antes de publicar.' }
            $commit = "$(git rev-parse --short HEAD)".Trim()
            if ($LASTEXITCODE -ne 0 -or -not $commit) { throw 'git rev-parse HEAD falhou; commit nao identificado.' }
        } finally { Pop-Location }
        foreach ($a in $Arquivos) { if (-not (Test-Path -LiteralPath (Join-Path $origem $a))) { throw "Arquivo ausente: $a" } }

        # Resumo
        $info = Obter-InfoFuncao $NomeProd
        Write-Host $(if ($Simular) { '=== RESUMO (SIMULACAO, nada sera publicado) ===' } else { '=== RESUMO DA PUBLICACAO ===' })
        Write-Host "Funcao: $NomeProd (projeto $ProjetoRef), verify_jwt=true"
        Write-Host "Versao atual em producao: v$($info.Versao)"
        Write-Host "Ramo: $ramo   Commit: $commit"
        foreach ($a in $Arquivos) { Write-Host ("  {0}  {1}" -f (Hash-Arquivo (Join-Path $origem $a)).Substring(0, 12), $a) }
        Write-Host '============================'

        # 2. Backup (aborta se falhar)
        $pastaBackup = Fazer-Backup $tmp

        # 3. Testes
        Push-Location $origem
        try {
            Write-Host 'deno test ...'
            & deno test
            if ($LASTEXITCODE -ne 0) { throw "deno test falhou (codigo $LASTEXITCODE)." }
            Write-Host 'deno check ...'
            & deno check index.ts logica.ts fatos.ts prompts.ts logica_test.ts
            if ($LASTEXITCODE -ne 0) { throw "deno check falhou (codigo $LASTEXITCODE)." }
        } finally { Pop-Location }

        # 4. Identico ao testado no dev
        Write-Host "Conferindo que o publicado em $NomeDev e identico ao disco ..."
        $infoDev = Obter-InfoFuncao $NomeDev
        if (-not $infoDev.VerifyJwt) { throw "$NomeDev esta com verify_jwt=false; o que vai a producao exige true. Nada foi publicado." }
        $devDir = Baixar-Funcao $NomeDev $tmp
        if (-not (Conferir-Hashes $origem $Arquivos $devDir 'dev')) { throw "O que vai a producao NAO e identico ao testado em $NomeDev. Publique o dev de novo e teste. Nada foi publicado." }
        Conferir-ListaExata $devDir $Arquivos 'dev'

        if ($Simular) {
            Write-Host "Backup: $pastaBackup"
            Write-Host 'SIMULACAO OK: nada publicado'
            $codigo = 0
        }
        else {
        # 5. Publica so a assistente
        Publicar-Producao $origem $Arquivos $true $tmp

        # 6. Baixa de volta e confere
        Write-Host 'Baixando de volta para conferir ...'
        $volta = Baixar-Funcao $NomeProd $tmp
        $confere = Conferir-Hashes $origem $Arquivos $volta 'publicado'
        $infoNova = Obter-InfoFuncao $NomeProd
        Write-Host "Versao em producao agora: v$($infoNova.Versao) (verify_jwt=$($infoNova.VerifyJwt))"
        if (-not $confere) { throw 'Conferencia falhou: publicado difere do disco.' }
        Conferir-ListaExata $volta $Arquivos 'producao'
        if ($infoNova.VerifyJwt -ne $true) { throw 'verify_jwt da producao NAO ficou true apos o deploy.' }

        # 7. Fumaca
        $ok = Rodar-Fumaca 'prod' $false
        if (-not $ok -and (Fumaca-Inconclusiva)) {
            Write-Host 'FUMACA: INCONCLUSIVO por limite (limite_*). Nao e falha de codigo; publicacao e conferencia passaram. Rode -Fumaca mais tarde. Se mesmo assim quiser voltar:'
            Write-Host "  $cmdSelf -Voltar `"$pastaBackup`" -Confirmo VOLTAR"
            $codigo = 3
        }
        elseif (-not $ok) {
            Write-Host 'FUMACA: FALHOU. NAO voltei sozinho. Para voltar atras, rode:'
            Write-Host "  $cmdSelf -Voltar `"$pastaBackup`" -Confirmo VOLTAR"
            $codigo = 1
        } else { Write-Host 'PUBLICADO: conferencia e fumaca PASSARAM.' }
        }
    }
    elseif ($Voltar) {
        $pasta = (Resolve-Path -LiteralPath $Voltar -ErrorAction Stop).Path
        $mf = Join-Path $pasta 'manifesto.json'
        if (-not (Test-Path -LiteralPath $mf)) { throw 'manifesto.json ausente na pasta do backup.' }
        $man = [IO.File]::ReadAllText($mf, $utf8) | ConvertFrom-Json
        if ($man.funcao -ne $NomeProd -or $man.projeto -ne $ProjetoRef) { throw 'Manifesto nao e da funcao/projeto de producao.' }
        $rels = @()
        foreach ($a in $man.arquivos) {
            $rel = ($a.caminho -replace '/', '\')
            if ($rel -match '\.\.') { throw "Caminho suspeito no manifesto: $rel" }
            $f = Join-Path $pasta $rel
            if (-not (Test-Path -LiteralPath $f)) { throw "Arquivo do manifesto ausente: $rel" }
            if ((Hash-Arquivo $f) -ne $a.sha256) { throw "sha256 nao bate com o manifesto: $rel" }
            $rels += $rel
        }
        if (-not ($rels -contains 'index.ts')) { throw 'Backup sem index.ts.' }

        $info = Obter-InfoFuncao $NomeProd
        Write-Host '=== RESUMO DA VOLTA ==='
        Write-Host "Funcao: $NomeProd (projeto $ProjetoRef), verify_jwt=$($man.verify_jwt)"
        Write-Host "Versao atual em producao: v$($info.Versao)  ->  conteudo do backup v$($man.versao) ($($man.data))"
        foreach ($a in $man.arquivos) { Write-Host ("  {0}  {1}" -f $a.sha256.Substring(0, 12), $a.caminho) }
        Write-Host '======================='

        Publicar-Producao $pasta $rels ([bool]$man.verify_jwt) $tmp
        Write-Host 'Baixando de volta para conferir ...'
        $volta = Baixar-Funcao $NomeProd $tmp
        $confere = Conferir-Hashes $pasta $rels $volta 'publicado'
        $infoNova = Obter-InfoFuncao $NomeProd
        Write-Host "Versao em producao agora: v$($infoNova.Versao) (verify_jwt=$($infoNova.VerifyJwt))"
        if (-not $confere) { throw 'Conferencia falhou: publicado difere do backup.' }
        Conferir-ListaExata $volta $rels 'producao'
        if ($infoNova.VerifyJwt -ne [bool]$man.verify_jwt) { throw "verify_jwt da producao ($($infoNova.VerifyJwt)) difere do manifesto ($([bool]$man.verify_jwt))." }
        $ok = Rodar-Fumaca 'prod' $true
        if ($ok) { Write-Host 'VOLTA: conferencia e catalogo PASSARAM.' }
        elseif (Fumaca-Inconclusiva) { Write-Host 'VOLTA: catalogo INCONCLUSIVO por limite (limite_*). Nao e falha de codigo.'; $codigo = 3 }
        else { Write-Host 'VOLTA: catalogo FALHOU.'; $codigo = 1 }
    }
} catch {
    Write-Host "ERRO: $($_.Exception.Message)"
    if ($Publicar -and $pastaBackup) {
        Write-Host "Backup da producao: $pastaBackup"
        Write-Host "Se algo ja foi publicado e precisa voltar: $cmdSelf -Voltar `"$pastaBackup`" -Confirmo VOLTAR"
    }
    $codigo = 1
} finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    Remove-Item Env:SUPABASE_ACCESS_TOKEN -ErrorAction SilentlyContinue
}
exit $codigo
