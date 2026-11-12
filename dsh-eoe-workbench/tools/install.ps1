# Installs the local EOE Workbench bundle into a DSH profile.
#
#   pwsh -NoProfile -File tools/install.ps1 -Profile desktop
#
# It creates the @local junction and updates package.json's dependencies +
# dsh.profile.bundles. It does NOT restart DSH. Restart DSH afterwards, then
# open the sidebar entry "EOE 工作台".
param(
  [string]$Profile = "desktop",
  [switch]$Remove
)

$ErrorActionPreference = "Stop"
$PluginDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$DshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE ".dsh" }
$ProfileDir = Join-Path $DshHome "profiles\$Profile"
$PackageJson = Join-Path $ProfileDir "package.json"
$LocalDir = Join-Path $ProfileDir "node_modules\@local"
$LinkPath = Join-Path $LocalDir "dsh-eoe-workbench"
$BundleName = "@local/dsh-eoe-workbench"

if (-not (Test-Path -LiteralPath $PackageJson)) {
  throw "DSH profile not found: $PackageJson"
}
New-Item -ItemType Directory -Force -Path $LocalDir | Out-Null

if ($Remove) {
  if (Test-Path -LiteralPath $LinkPath) {
    (Get-Item -LiteralPath $LinkPath -Force).Delete()
  }
  $pkg = Get-Content -LiteralPath $PackageJson -Raw | ConvertFrom-Json
  if ($pkg.dependencies.PSObject.Properties.Name -contains $BundleName) {
    $pkg.dependencies.PSObject.Properties.Remove($BundleName)
  }
  $pkg.dsh.profile.bundles = @($pkg.dsh.profile.bundles | Where-Object { $_ -ne $BundleName })
  $pkg | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $PackageJson -Encoding utf8
  Write-Host "Removed $BundleName from profile '$Profile'."
  exit 0
}

if (Test-Path -LiteralPath $LinkPath) {
  $existing = Get-Item -LiteralPath $LinkPath -Force
  $existingTarget = @($existing.Target)[0]
  if ($null -ne $existingTarget) {
    $existingTarget = [string]$existingTarget -replace '^Global\\', ''
  }
  $sameTarget =
    $existing.LinkType -eq "Junction" -and
    $null -ne $existingTarget -and
    [IO.Path]::GetFullPath($existingTarget) -eq [IO.Path]::GetFullPath($PluginDir)
  if (-not $sameTarget) {
    throw "Refusing to replace existing non-junction or different link: $LinkPath -> $existingTarget"
  }
} else {
  New-Item -ItemType Junction -Path $LinkPath -Target $PluginDir | Out-Null
}

$backup = "$PackageJson.bak-eoe-$(Get-Date -Format yyyyMMdd-HHmmss)"
Copy-Item -LiteralPath $PackageJson -Destination $backup
$pkg = Get-Content -LiteralPath $PackageJson -Raw | ConvertFrom-Json
if ($null -eq $pkg.dependencies) {
  $pkg | Add-Member -MemberType NoteProperty -Name dependencies -Value ([pscustomobject]@{})
}
if (-not ($pkg.dependencies.PSObject.Properties.Name -contains $BundleName)) {
  $pkg.dependencies | Add-Member -MemberType NoteProperty -Name $BundleName -Value "file:../../local-plugins/dsh-eoe-workbench"
}
if ($null -eq $pkg.dsh.profile.bundles) {
  $pkg.dsh.profile.bundles = @()
}
if (-not ($pkg.dsh.profile.bundles -contains $BundleName)) {
  $pkg.dsh.profile.bundles = @($pkg.dsh.profile.bundles) + $BundleName
}
$pkg | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $PackageJson -Encoding utf8

Write-Host "Installed $BundleName into profile '$Profile'."
Write-Host "  link    : $LinkPath -> $PluginDir"
Write-Host "  package : $PackageJson"
Write-Host "  backup  : $backup"
Write-Host "Restart DSH to load the host + client halves."
