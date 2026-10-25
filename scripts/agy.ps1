$ErrorActionPreference = 'Stop'
$model = 'gemini-3.8-flash-low'

if ($args | Where-Object { $_ -eq '--model' -or $_ -like '--model=*' }) {
  throw "AGY model is pinned to $model by scripts/agy.ps1; remove the model override."
}

$agyCommand = Get-Command agy.exe -CommandType Application -ErrorAction Stop
& $agyCommand.Source --model $model @args
exit $LASTEXITCODE
