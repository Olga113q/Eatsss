<#
.SYNOPSIS
    Проверяет, какие DLC-карты ARK: Survival Ascended не установлены, и просит Steam их установить.

.DESCRIPTION
    Скрипт ничего не обходит и не подменяет. Он только:
      1. находит Steam и папку с игрой;
      2. читает appmanifest_2399830.acf и смотрит, какие депо DLC уже скачаны;
      3. для недостающих DLC открывает ссылку steam://install/<id>. Steam сам решает,
         есть ли у тебя лицензия, и показывает обычное окно установки.

    DLC без отдельных файлов (костюмы, Fantastic Tames, Bob's Tall Tales, пропуски)
    скачивать не нужно: их содержимое уже лежит в основной игре и включается лицензией.

.PARAMETER Validate
    После установки запустить проверку целостности файлов игры в Steam.

.PARAMETER ListOnly
    Только показать список, ничего не устанавливать.
#>
[CmdletBinding()]
param(
    [switch]$Validate,
    [switch]$ListOnly
)

$ErrorActionPreference = 'Stop'

$GameAppId = 2399830

# DLC с отдельными депо (карты). AppId DLC совпадает с его DepotId.
# Ключи строками: OrderedDictionary с числовым ключом индексирует по позиции.
$MapDlcs = [ordered]@{
    "2827030" = "ARK: The Center Ascended"
    "2849450" = "ARK: Scorched Earth Ascended"
    "3059650" = "ARK: Aberration Ascended"
    "3349320" = "ARK: Extinction Ascended"
    "3483400" = "ARK: Astraeos"
    "3583650" = "ARK: Lost Colony"
    "3675020" = "ARK: Ragnarok Ascended"
    "3982310" = "ARK: Valguero Ascended"
}

function Get-SteamPath {
    foreach ($key in 'HKCU:\Software\Valve\Steam', 'HKLM:\SOFTWARE\WOW6432Node\Valve\Steam', 'HKLM:\SOFTWARE\Valve\Steam') {
        $props = Get-ItemProperty -Path $key -ErrorAction SilentlyContinue
        foreach ($name in 'SteamPath', 'InstallPath') {
            $value = $props.$name
            if ($value -and (Test-Path -LiteralPath $value)) {
                return [IO.Path]::GetFullPath(($value -replace '/', '\'))
            }
        }
    }
    throw "Steam не найден. Установи Steam или запусти его хотя бы один раз."
}

function Get-LibraryFolders([string]$steamPath) {
    $folders = [Collections.Generic.List[string]]::new()
    $folders.Add($steamPath)
    $vdf = Join-Path $steamPath 'steamapps\libraryfolders.vdf'
    if (Test-Path -LiteralPath $vdf) {
        $text = Get-Content -LiteralPath $vdf -Raw -Encoding UTF8
        foreach ($m in [regex]::Matches($text, '"path"\s+"([^"]+)"')) {
            $path = $m.Groups[1].Value -replace '\\\\', '\'
            if (-not ($folders -contains $path)) { $folders.Add($path) }
        }
    }
    return $folders
}

# Возвращает id депо из блока "InstalledDepots" в .acf-файле.
function Get-InstalledDepots([string]$manifestPath) {
    $text = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8
    $start = $text.IndexOf('"InstalledDepots"')
    $ids = [Collections.Generic.HashSet[int]]::new()
    if ($start -lt 0) { return ,$ids }

    # Ищем границы блока по балансу фигурных скобок.
    $open = $text.IndexOf('{', $start)
    $depth = 0
    $end = $open
    for ($i = $open; $i -lt $text.Length; $i++) {
        if ($text[$i] -eq '{') { $depth++ }
        elseif ($text[$i] -eq '}') { $depth--; if ($depth -eq 0) { $end = $i; break } }
    }
    $block = $text.Substring($open + 1, $end - $open - 1)

    # Ключи первого уровня внутри блока: "123456" {
    foreach ($m in [regex]::Matches($block, '"(\d+)"\s*\{')) {
        [void]$ids.Add([int]$m.Groups[1].Value)
    }
    # Запятая не даёт PowerShell развернуть коллекцию в массив при возврате.
    return ,$ids
}

$steamPath = Get-SteamPath
Write-Host "Steam: $steamPath"

$manifest = $null
foreach ($lib in Get-LibraryFolders $steamPath) {
    $candidate = Join-Path $lib "steamapps\appmanifest_$GameAppId.acf"
    if (Test-Path -LiteralPath $candidate) { $manifest = $candidate; break }
}
if (-not $manifest) {
    Write-Host "ARK: Survival Ascended не установлена ни в одной библиотеке Steam. Открываю установку игры..." -ForegroundColor Yellow
    if (-not $ListOnly) { Start-Process "steam://install/$GameAppId" }
    return
}
Write-Host "Игра: $(Split-Path $manifest -Parent)`n"

$installed = Get-InstalledDepots $manifest
$missing = @()
foreach ($id in @($MapDlcs.Keys)) {
    if ($installed.Contains([int]$id)) {
        Write-Host ("  [+] {0}" -f $MapDlcs[$id]) -ForegroundColor Green
    } else {
        Write-Host ("  [ ] {0}" -f $MapDlcs[$id]) -ForegroundColor DarkYellow
        $missing += $id
    }
}
Write-Host ""

if ($missing.Count -eq 0) {
    Write-Host "Все DLC-карты уже установлены." -ForegroundColor Green
} elseif ($ListOnly) {
    Write-Host "Не установлено: $($missing.Count). Запусти без -ListOnly, чтобы установить."
} else {
    Write-Host "Не установлено: $($missing.Count). Сейчас Steam по очереди покажет окна установки."
    Write-Host "Если какое-то DLC не куплено, Steam откроет его страницу в магазине, это нормально.`n"
    foreach ($id in $missing) {
        Write-Host "  -> $($MapDlcs[$id])"
        Start-Process "steam://install/$id"
        Start-Sleep -Seconds 3
    }
    Write-Host "`nЕсли окно установки не появилось, включи DLC вручную:"
    Write-Host "  Steam -> Библиотека -> ARK: Survival Ascended -> Свойства -> DLC -> поставь галочки."
}

if ($Validate -and -not $ListOnly) {
    Write-Host "`nЗапускаю проверку целостности файлов..."
    Start-Process "steam://validate/$GameAppId"
}
