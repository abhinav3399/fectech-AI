param([string]$Python = "venv\Scripts\python.exe")
$ErrorActionPreference = 'Stop'
$root = (Get-Location).Path
$dist = Join-Path $root 'dist'
$build = Join-Path $root 'build'
$runtime = Join-Path $root 'desktop\runtime'

function Stop-FactechProcess {
	param([int]$ProcessId)
	try {
		$process = Get-Process -Id $ProcessId -ErrorAction Stop
		$path = $process.MainModule.FileName
		if ($path -and $path.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
			Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
			return
		}
	} catch { }
	try {
		$commandLine = (Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId").CommandLine
		if ($commandLine -and $commandLine -match [regex]::Escape($root)) {
			Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
		}
	} catch { }
}

# Stop only processes whose executable or command line belongs to this repository.
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
	Where-Object {
		$_.CommandLine -and
		$_.CommandLine -match [regex]::Escape($root) -and
		$_.Name -match '^(python|pythonw|electron|backend|model)(\.exe)?$'
	} |
	ForEach-Object { Stop-FactechProcess $_.ProcessId }

if (-not (Test-Path $Python)) { throw "Python executable not found: $Python" }
& $Python -m pip show pyinstaller *> $null
if ($LASTEXITCODE -ne 0) { throw "PyInstaller is required. Install it with: $Python -m pip install pyinstaller" }

New-Item -ItemType Directory -Force $dist, $build, $runtime | Out-Null
Remove-Item (Join-Path $runtime 'backend.exe'), (Join-Path $runtime 'model.exe') -Force -ErrorAction SilentlyContinue

function Build-Service {
	param([string]$Name, [string]$Entry, [string[]]$ExtraArgs)
	$work = Join-Path $build $Name
	$spec = $root
	Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
	Remove-Item (Join-Path $root "$Name.spec") -Force -ErrorAction SilentlyContinue
	New-Item -ItemType Directory -Force $work | Out-Null
	& $Python -m PyInstaller --noconfirm --clean --onefile --name $Name --distpath $dist --workpath $work --specpath $spec --paths . @ExtraArgs $Entry | Out-Host
	if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed while building $Name.exe (exit code $LASTEXITCODE)." }
	$exe = Join-Path $dist "$Name.exe"
	if (-not (Test-Path $exe)) { throw "$Name executable was not created: $exe" }
	if ((Get-Item $exe).Length -le 0) { throw "$Name executable is empty: $exe" }
	return $exe
}

$backendExe = Build-Service 'backend' 'desktop\backend_entry.py' @()
$modelSource = Join-Path $root 'model_service\models'
if (Test-Path $modelSource -PathType Container) {
	Write-Output "Including model data: $modelSource"
	$modelData = "--add-data=model_service\models;model_service/models"
	$modelArgs = @($modelData)
} else {
	Write-Output "Model data directory not found; building model.exe without optional model data: $modelSource"
	$modelArgs = @()
}
$modelExe = Build-Service 'model' 'desktop\model_entry.py' $modelArgs

if (-not (Test-Path $backendExe)) { throw "Backend executable was not created: $backendExe" }
if (-not (Test-Path $modelExe)) { throw "Model executable was not created: $modelExe" }
if ((Get-Item $backendExe).Length -le 0) { throw "Backend executable is empty: $backendExe" }
if ((Get-Item $modelExe).Length -le 0) { throw "Model executable is empty: $modelExe" }

Copy-Item $backendExe (Join-Path $runtime 'backend.exe') -Force
Copy-Item $modelExe (Join-Path $runtime 'model.exe') -Force
New-Item -ItemType Directory -Force (Join-Path $runtime 'model_service\models') | Out-Null
Copy-Item model_service\models\face_landmarker.task (Join-Path $runtime 'model_service\models\face_landmarker.task') -Force
Write-Output "Built backend: $backendExe ($((Get-Item $backendExe).Length) bytes)"
Write-Output "Built model:   $modelExe ($((Get-Item $modelExe).Length) bytes)"