$ErrorActionPreference = 'Stop'
$tier = 'medium'
$requestedEffort = $null
$forwardArgs = [System.Collections.Generic.List[string]]::new()

for ($index = 0; $index -lt $args.Count; $index++) {
  $argument = [string]$args[$index]

  if ($argument -eq '-Tier' -or $argument -eq '--model-tier') {
    if ($index + 1 -ge $args.Count) {
      throw 'Expected low, medium, or high after -Tier.'
    }
    $tier = [string]$args[++$index]
    continue
  }

  if ($argument -like '--model-tier=*') {
    $tier = $argument.Substring('--model-tier='.Length)
    continue
  }

  if ($argument -eq '--effort') {
    if ($index + 1 -ge $args.Count) {
      throw 'Expected low, medium, or high after --effort.'
    }
    $requestedEffort = [string]$args[++$index]
    continue
  }

  if ($argument -like '--effort=*') {
    $requestedEffort = $argument.Substring('--effort='.Length)
    continue
  }

  if ($argument -eq '--model' -or $argument -like '--model=*') {
    throw 'Select an AGY tier with -Tier low|medium|high; model overrides are not allowed.'
  }

  $forwardArgs.Add($argument)
}

if ($tier -notin @('low', 'medium', 'high')) {
  throw "Unsupported AGY model tier '$tier'; choose low, medium, or high."
}

if ($requestedEffort -and $requestedEffort -ne $tier) {
  throw "AGY model tier '$tier' conflicts with reasoning effort '$requestedEffort'; use matching values or omit --effort."
}

if ($requestedEffort) {
  $forwardArgs.Insert(0, '--effort')
  $forwardArgs.Insert(1, $requestedEffort)
}

$model = "gemini-3.8-flash-$tier"
$agyCommand = Get-Command agy.exe -CommandType Application -ErrorAction Stop
$agyArgs = $forwardArgs.ToArray()
& $agyCommand.Source --model $model @agyArgs
exit $LASTEXITCODE
