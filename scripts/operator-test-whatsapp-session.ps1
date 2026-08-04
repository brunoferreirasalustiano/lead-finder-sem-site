[CmdletBinding()]
param(
    [switch]$TestMode
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$expectedWorkingDirectory = 'C:\Users\corey\AppData\Local\Temp\lead-finder-whatsapp-final-test'
$expectedPhoneSuffix = '4982'
$expectedHmlBindingFingerprint = 'a28c046e1d33'
$expectedBindingVersion = 'operator-recipient-binding-v1'
$privateNames = @(
    'API_AUTH_TOKEN',
    'OPERATOR_TEST_RECIPIENT_BINDING_KEY',
    'OPERATOR_TEST_FINGERPRINT_KEY'
)
$environmentNames = @(
    'OPERATOR_TEST_AUTHORIZED',
    'LEAD_FINDER_API_URL',
    'OPERATOR_TEST_WHATSAPP_E164',
    'OPERATOR_TEST_EXPECTED_PHONE_SUFFIX',
    'OPERATOR_TEST_HML_PHONE_SUFFIX',
    'OPERATOR_TEST_HML_BINDING_FINGERPRINT',
    'OPERATOR_TEST_HML_MESSAGE_DIGEST_FINGERPRINT',
    'OPERATOR_TEST_HML_TEMPLATE_FINGERPRINT',
    'OPERATOR_TEST_HML_BINDING_VERSION'
) + $privateNames
$originalEnvironment = @{}
$configuredNames = New-Object 'System.Collections.Generic.List[string]'
$failureCode = 'SESSION_FAILED'
$stage = 'START'
$exitCode = 0

function Stop-Safely {
    param([Parameter(Mandatory = $true)][string]$Code)

    $script:failureCode = $Code
    throw (New-Object System.InvalidOperationException('operator session stopped'))
}

function Get-NormalizedPath {
    param([Parameter(Mandatory = $true)][string]$Path)

    return ([System.IO.Path]::GetFullPath($Path)).TrimEnd('\', '/')
}

function Test-ForbiddenPath {
    param([Parameter(Mandatory = $true)][string]$Path)

    return $Path -match '(?i)^D:(?:[\\/]|$)'
}

function Set-ProcessEnvironmentValue {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Value
    )

    [Environment]::SetEnvironmentVariable(
        $Name,
        $Value,
        [EnvironmentVariableTarget]::Process
    )
    $readBack = [Environment]::GetEnvironmentVariable(
        $Name,
        [EnvironmentVariableTarget]::Process
    )
    $providerValue = (Get-Item -LiteralPath "Env:$Name" -ErrorAction SilentlyContinue).Value
    if ($readBack -cne $Value -or $providerValue -cne $Value) {
        Stop-Safely "${Name}_PROCESS_READBACK_FAILED"
    }
    if (-not $configuredNames.Contains($Name)) {
        $null = $configuredNames.Add($Name)
    }
}

function ConvertFrom-SecureStringValue {
    param([AllowNull()][Security.SecureString]$SecureValue)

    $bstr = [IntPtr]::Zero
    try {
        if ($null -eq $SecureValue) {
            return ''
        }
        $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
        if ($bstr -eq [IntPtr]::Zero) {
            return ''
        }
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    }
    finally {
        if ($bstr -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
        }
        if ($null -ne $SecureValue) {
            $SecureValue.Dispose()
        }
    }
}

function Read-SecretValue {
    param([Parameter(Mandatory = $true)][string]$Name)

    $secureValue = Read-Host -Prompt "$Name (entrada oculta)" -AsSecureString
    return ConvertFrom-SecureStringValue $secureValue
}

function Get-SecretFormatError {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [AllowEmptyString()][AllowNull()][string]$Value
    )

    if ([string]::IsNullOrEmpty($Value)) {
        return "${Name}_MISSING"
    }
    if ($Value.Length -lt 32 -or $Value.Length -gt 512) {
        return "${Name}_FORMAT_INVALID"
    }
    if ($Value -match '[\r\n]') {
        return "${Name}_LINE_BREAK"
    }
    if ($Value -match '[^\x21-\x7e]') {
        return "${Name}_FORMAT_INVALID"
    }
    if ($Value -match '(?i)(\$env:|(?:^|[\s;|&])(?:Set|Get|Invoke|Start|Stop|New|Remove|Write|Read|Test)-[A-Za-z]+|(?:^|[\s;|&])(?:Where-Object|ForEach-Object)\b)') {
        return "${Name}_POWERSHELL_COMMAND"
    }
    return $null
}

function Write-SecretStatus {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [AllowNull()][string]$Value,
        [AllowNull()][string]$FormatError
    )

    $present = -not [string]::IsNullOrEmpty($Value)
    $formatOk = $present -and [string]::IsNullOrEmpty($FormatError)
    Write-Output "${Name}_PRESENT=$($present.ToString().ToLowerInvariant())"
    Write-Output "${Name}_FORMAT_OK=$($formatOk.ToString().ToLowerInvariant())"
}

function Get-FingerprintDiagnostics {
    $source = "import { expectedOperatorMessageDigestFingerprint, expectedOperatorTemplateFingerprint, sanitizedFingerprintIfPresent } from './scripts/operator-test-whatsapp-preflight.ts'; console.log(JSON.stringify({binding: sanitizedFingerprintIfPresent('OPERATOR_TEST_RECIPIENT_BINDING_KEY', process.env.OPERATOR_TEST_RECIPIENT_BINDING_KEY), message: expectedOperatorMessageDigestFingerprint(), template: expectedOperatorTemplateFingerprint()}));"
    $output = @(& npx --no-install tsx -e $source 2>&1)
    $childExitCode = $LASTEXITCODE
    $jsonLine = $output |
        Where-Object { $_ -is [string] -and $_.TrimStart().StartsWith('{') } |
        Select-Object -Last 1
    if ($childExitCode -ne 0 -or [string]::IsNullOrEmpty($jsonLine)) {
        Stop-Safely 'FINGERPRINT_DIAGNOSTIC_FAILED'
    }
    try {
        $diagnostics = $jsonLine | ConvertFrom-Json
    }
    catch {
        Stop-Safely 'FINGERPRINT_DIAGNOSTIC_INVALID'
    }
    foreach ($property in @('binding', 'message', 'template')) {
        $value = [string]$diagnostics.$property
        if ($value -ne 'UNAVAILABLE' -and $value -notmatch '^[0-9a-fA-F]{12}$') {
            Stop-Safely 'FINGERPRINT_DIAGNOSTIC_UNSANITIZED'
        }
    }
    return $diagnostics
}

function Test-ChildEnvironmentInheritance {
    $nodeOutput = @(& node -e "const names=['API_AUTH_TOKEN','OPERATOR_TEST_RECIPIENT_BINDING_KEY','OPERATOR_TEST_FINGERPRINT_KEY']; process.stdout.write(names.every((name)=>Boolean(process.env[name]))?'CHILD_ENV_PRESENT=true':'CHILD_ENV_PRESENT=false')" 2>&1)
    if ($LASTEXITCODE -ne 0 -or ($nodeOutput -join '').Trim() -ne 'CHILD_ENV_PRESENT=true') {
        Stop-Safely 'CHILD_ENV_INHERITANCE_FAILED'
    }
    $tsxOutput = @(& npx --no-install tsx -e "const names=['API_AUTH_TOKEN','OPERATOR_TEST_RECIPIENT_BINDING_KEY','OPERATOR_TEST_FINGERPRINT_KEY']; process.stdout.write(names.every((name)=>Boolean(process.env[name]))?'TSX_ENV_PRESENT=true':'TSX_ENV_PRESENT=false')" 2>&1)
    if ($LASTEXITCODE -ne 0 -or ($tsxOutput -join '').Trim() -ne 'TSX_ENV_PRESENT=true') {
        Stop-Safely 'TSX_ENV_INHERITANCE_FAILED'
    }
    $npmOutput = @(& npm exec --yes -- node -e "const names=['API_AUTH_TOKEN','OPERATOR_TEST_RECIPIENT_BINDING_KEY','OPERATOR_TEST_FINGERPRINT_KEY']; process.stdout.write(names.every((name)=>Boolean(process.env[name]))?'NPM_ENV_PRESENT=true':'NPM_ENV_PRESENT=false')" 2>&1)
    $npmExitCode = $LASTEXITCODE
    $npmResult = $npmOutput |
        Where-Object { $_ -is [string] -and $_.Trim() -eq 'NPM_ENV_PRESENT=true' } |
        Select-Object -Last 1
    if ($npmExitCode -ne 0 -or [string]$npmResult -ne 'NPM_ENV_PRESENT=true') {
        Stop-Safely 'NPM_ENV_INHERITANCE_FAILED'
    }
}

try {
    $stage = 'WORKING_DIRECTORY'
    $actualWorkingDirectory = Get-NormalizedPath ((Get-Location).ProviderPath)
    $stage = 'WORKING_DIRECTORY_ACTUAL'
    $scriptDirectory = Get-NormalizedPath (Join-Path $expectedWorkingDirectory 'scripts')
    $stage = 'WORKING_DIRECTORY_SCRIPT'
    if ((Test-ForbiddenPath $actualWorkingDirectory) -or (Test-ForbiddenPath $scriptDirectory)) {
        Stop-Safely 'FORBIDDEN_DRIVE'
    }
    if (-not [StringComparer]::OrdinalIgnoreCase.Equals($actualWorkingDirectory, $expectedWorkingDirectory)) {
        Stop-Safely 'WORKING_DIRECTORY_MISMATCH'
    }

    foreach ($name in $environmentNames) {
        $previous = [Environment]::GetEnvironmentVariable($name, [EnvironmentVariableTarget]::Process)
        $originalEnvironment[$name] = [pscustomobject]@{
            Present = $null -ne $previous
            Value = $previous
        }
    }

    if ($TestMode) {
        $stage = 'SYNTHETIC_INPUT'
        $phone = '+5511999994982'
        $secretValues = @{
            API_AUTH_TOKEN = 'synthetic-api-token-0000000000000000000000000000'
            OPERATOR_TEST_RECIPIENT_BINDING_KEY = 'synthetic-binding-key-0000000000000000000000000000'
            OPERATOR_TEST_FINGERPRINT_KEY = 'synthetic-fingerprint-key-0000000000000000000000000'
        }
    }
    else {
        $stage = 'SECRET_INPUT'
        $phone = (Read-Host 'OPERATOR_TEST_WHATSAPP_E164 (numero autorizado terminado em 4982)').Trim()
        $secretValues = @{}
        foreach ($name in $privateNames) {
            $secretValues[$name] = Read-SecretValue $name
        }
    }

    if ($phone -notmatch '^\+[1-9]\d{7,14}$' -or $phone.Substring($phone.Length - 4) -ne $expectedPhoneSuffix) {
        Stop-Safely 'RECIPIENT_MISMATCH'
    }

    foreach ($name in $privateNames) {
        $stage = "VALIDATE_$name"
        $formatError = Get-SecretFormatError $name $secretValues[$name]
        Write-SecretStatus $name $secretValues[$name] $formatError
        if (-not [string]::IsNullOrEmpty($formatError)) {
            Stop-Safely 'SECRET_FORMAT_INVALID'
        }
    }
    if ([StringComparer]::Ordinal.Equals($secretValues.API_AUTH_TOKEN, $secretValues.OPERATOR_TEST_RECIPIENT_BINDING_KEY) -or
        [StringComparer]::Ordinal.Equals($secretValues.API_AUTH_TOKEN, $secretValues.OPERATOR_TEST_FINGERPRINT_KEY) -or
        [StringComparer]::Ordinal.Equals($secretValues.OPERATOR_TEST_RECIPIENT_BINDING_KEY, $secretValues.OPERATOR_TEST_FINGERPRINT_KEY)) {
        Stop-Safely 'SECRETS_MUST_BE_DISTINCT'
    }

    foreach ($name in $privateNames) {
        $stage = "SET_$name"
        Set-ProcessEnvironmentValue $name $secretValues[$name]
    }

    $metadata = [ordered]@{
        OPERATOR_TEST_AUTHORIZED = 'true'
        LEAD_FINDER_API_URL = 'https://lead-finder-api-hml.onrender.com'
        OPERATOR_TEST_WHATSAPP_E164 = $phone
        OPERATOR_TEST_EXPECTED_PHONE_SUFFIX = $expectedPhoneSuffix
        OPERATOR_TEST_HML_PHONE_SUFFIX = $expectedPhoneSuffix
        OPERATOR_TEST_HML_BINDING_FINGERPRINT = $expectedHmlBindingFingerprint
        OPERATOR_TEST_HML_BINDING_VERSION = $expectedBindingVersion
    }
    foreach ($entry in $metadata.GetEnumerator()) {
        $stage = "SET_$($entry.Key)"
        Set-ProcessEnvironmentValue $entry.Key ([string]$entry.Value)
    }

    $stage = 'FINGERPRINT_DIAGNOSTICS'
    $fingerprints = Get-FingerprintDiagnostics
    if ($TestMode) {
        $stage = 'TEST_CHILD_INHERITANCE'
        $metadata.OPERATOR_TEST_HML_BINDING_FINGERPRINT = [string]$fingerprints.binding
        Set-ProcessEnvironmentValue 'OPERATOR_TEST_HML_BINDING_FINGERPRINT' $metadata.OPERATOR_TEST_HML_BINDING_FINGERPRINT
    }
    if ([string]$fingerprints.binding -eq 'UNAVAILABLE') {
        Write-Output 'BINDING_FINGERPRINT=UNAVAILABLE'
        Write-Output 'BINDING_FINGERPRINT_MATCH=false'
        Stop-Safely 'BINDING_FINGERPRINT_MISMATCH'
    }
    $bindingMatches = [StringComparer]::OrdinalIgnoreCase.Equals(
        [string]$fingerprints.binding,
        [string]$metadata.OPERATOR_TEST_HML_BINDING_FINGERPRINT
    )
    Write-Output "BINDING_FINGERPRINT=$($fingerprints.binding)"
    Write-Output "BINDING_FINGERPRINT_MATCH=$($bindingMatches.ToString().ToLowerInvariant())"
    if (-not $bindingMatches) {
        Stop-Safely 'BINDING_FINGERPRINT_MISMATCH'
    }
    Set-ProcessEnvironmentValue 'OPERATOR_TEST_HML_MESSAGE_DIGEST_FINGERPRINT' ([string]$fingerprints.message)
    Set-ProcessEnvironmentValue 'OPERATOR_TEST_HML_TEMPLATE_FINGERPRINT' ([string]$fingerprints.template)

    if ($TestMode) {
        Test-ChildEnvironmentInheritance
        Write-Output 'TEST_MODE=PASS'
        Write-Output 'CONSOLE_STARTED=false'
    }
    else {
        $stage = 'PREFLIGHT'
        $preflightOutput = @(& npm run operator:test:whatsapp:preflight 2>&1)
        $preflightExitCode = $LASTEXITCODE
        $reportLine = $preflightOutput |
            Where-Object { $_ -is [string] -and $_.TrimStart().StartsWith('{') } |
            Select-Object -Last 1
        if ($preflightExitCode -ne 0 -or [string]::IsNullOrEmpty($reportLine)) {
            Stop-Safely 'PREFLIGHT_FAILED'
        }
        try {
            $preflightReport = $reportLine | ConvertFrom-Json
        }
        catch {
            Stop-Safely 'PREFLIGHT_REPORT_INVALID'
        }
        if ([string]$preflightReport.status -ne 'PASS') {
            Stop-Safely 'PREFLIGHT_FAILED'
        }
        Write-Output 'PREFLIGHT_RESULT=PASS'
        Write-Output 'CONSOLE_STARTED=true'
        $stage = 'CONSOLE'
        & npx --no-install tsx scripts/operator-test-console-v2.ts
        if ($LASTEXITCODE -ne 0) {
            $exitCode = $LASTEXITCODE
        }
    }
}
catch {
    Write-Output 'STATUS=FAIL'
    Write-Output "ERROR=$failureCode"
    Write-Output "STAGE=$stage"
    $exitCode = 1
}
finally {
    foreach ($name in $environmentNames) {
        $original = $originalEnvironment[$name]
        if ($null -eq $original) {
            continue
        }
        if ($original.Present) {
            [Environment]::SetEnvironmentVariable(
                $name,
                [string]$original.Value,
                [EnvironmentVariableTarget]::Process
            )
        }
        else {
            [Environment]::SetEnvironmentVariable(
                $name,
                $null,
                [EnvironmentVariableTarget]::Process
            )
        }
    }
    Remove-Variable secretValues, fingerprints, preflightReport, preflightOutput, reportLine -ErrorAction SilentlyContinue
}

exit $exitCode
