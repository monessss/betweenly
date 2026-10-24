param(
    [int]$GatewayPort = 58080,
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$gatewayRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$solution = Join-Path $gatewayRoot "Gateway.sln"
$gatewayOutput = Join-Path $gatewayRoot "bin/Debug/net8.0"
$mockScript = Join-Path $gatewayRoot "tests/gateway/mock-upstream.mjs"
$processes = @()
$oldEnvironment = $env:ASPNETCORE_ENVIRONMENT
$oldDotnetEnvironment = $env:DOTNET_ENVIRONMENT

if (-not $SkipBuild) {
    dotnet build $solution --configuration Debug --no-restore
    if ($LASTEXITCODE -ne 0) {
        throw "Gateway build failed."
    }
}

function Start-HiddenProcess([string]$FileName, [string[]]$Arguments, [string]$WorkingDirectory) {
    $process = Start-Process `
        -FilePath $FileName `
        -ArgumentList $Arguments `
        -WorkingDirectory $WorkingDirectory `
        -WindowStyle Hidden `
        -PassThru
    $script:processes += $process
    return $process
}

function Wait-HttpOk([string]$Uri) {
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        try {
            $response = Invoke-WebRequest `
                -Uri $Uri `
                -UseBasicParsing `
                -TimeoutSec 2 `
                -SkipHttpErrorCheck
            if ($response.StatusCode -eq 200) {
                return
            }
        }
        catch {
            # Process may still be starting.
        }

        Start-Sleep -Milliseconds 250
    }

    throw "HTTP endpoint did not become healthy: $Uri"
}

try {
    foreach ($port in 5101..5104) {
        $null = Start-HiddenProcess "node" @($mockScript, "$port") $gatewayRoot
    }

    $env:ASPNETCORE_ENVIRONMENT = "Development"
    $env:DOTNET_ENVIRONMENT = "Development"
    $null = Start-HiddenProcess `
        "dotnet" `
        @("SocialAssistant.Gateway.dll", "--urls", "http://127.0.0.1:$GatewayPort") `
        $gatewayOutput

    Wait-HttpOk "http://127.0.0.1:$GatewayPort/healthz"
    Wait-HttpOk "http://127.0.0.1:$GatewayPort/readyz"

    $userId = "7bc4918a-9079-4ea2-9e8e-369ad79a9f20"
    $correlationId = "gateway-smoke-trace"

    $proxyResponse = Invoke-WebRequest `
        -Uri "http://127.0.0.1:$GatewayPort/api/v1/me/expression-style?source=test" `
        -Headers @{
            "X-Dev-User-Id" = $userId
            "X-User-Id" = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
            "X-Gateway-Key" = "spoofed-key"
            "X-Service-Name" = "ContactContextService"
            "X-Service-Key" = "spoofed-service-key"
            "X-Acting-User-Id" = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
            "X-Correlation-Id" = $correlationId
        } `
        -UseBasicParsing `
        -SkipHttpErrorCheck
    $proxy = $proxyResponse.Content | ConvertFrom-Json

    if ($proxyResponse.StatusCode -ne 200) {
        throw "Expected proxied GET to return 200."
    }
    if ($proxy.method -ne "GET" -or $proxy.url -ne "/api/v1/me/expression-style?source=test") {
        throw "Method or query string was not preserved."
    }
    if ($proxy.headers."x-user-id" -ne $userId) {
        throw "Gateway did not inject the authenticated user."
    }
    if ($proxy.headers."x-gateway-key" -ne "dev-style-gateway-key") {
        throw "Gateway did not inject the target service key."
    }
    if ($proxy.headers."x-service-name" -or
        $proxy.headers."x-service-key" -or
        $proxy.headers."x-acting-user-id" -or
        $proxy.headers."x-dev-user-id") {
        throw "Gateway forwarded a trusted or development-only header."
    }
    if ($proxyResponse.Headers["X-Correlation-Id"] -ne $correlationId) {
        throw "Correlation ID was not preserved."
    }

    $postBody = '{"label":"测试对象","relationshipStage":"JUST_CONNECTED"}'
    $postResponse = Invoke-WebRequest `
        -Method "POST" `
        -Uri "http://127.0.0.1:$GatewayPort/api/v1/contacts" `
        -ContentType "application/json" `
        -Body $postBody `
        -Headers @{ "X-Dev-User-Id" = $userId } `
        -UseBasicParsing `
        -SkipHttpErrorCheck
    $postProxy = $postResponse.Content | ConvertFrom-Json

    if ($postResponse.StatusCode -ne 200 -or
        $postProxy.method -ne "POST" -or
        $postProxy.body.label -ne "测试对象") {
        throw "Gateway did not stream the JSON request body correctly."
    }

    $internalResponse = Invoke-WebRequest `
        -Method "POST" `
        -Uri "http://127.0.0.1:$GatewayPort/internal/v1/analysis" `
        -ContentType "application/json" `
        -Body '{"requestId":"16a32864-cb33-46ce-8ef9-c5c559d33e63"}' `
        -Headers @{
            "X-Service-Name" = "AdviceService"
            "X-Service-Key" = "dev-advice-service-key"
            "X-Acting-User-Id" = $userId
        } `
        -UseBasicParsing `
        -SkipHttpErrorCheck
    $internalProxy = $internalResponse.Content | ConvertFrom-Json

    if ($internalResponse.StatusCode -ne 200 -or
        $internalProxy.headers."x-user-id" -ne $userId -or
        $internalProxy.headers."x-gateway-key" -ne "dev-analysis-gateway-key") {
        throw "INTERNAL proxy identity headers are incorrect. " +
            "status=$($internalResponse.StatusCode), " +
            "userId=$($internalProxy.headers.'x-user-id'), " +
            "gatewayKey=$($internalProxy.headers.'x-gateway-key'), " +
            "body=$($internalResponse.Content)"
    }

    $forbiddenResponse = Invoke-WebRequest `
        -Method "POST" `
        -Uri "http://127.0.0.1:$GatewayPort/internal/v1/analysis" `
        -Headers @{
            "X-Service-Name" = "ContactContextService"
            "X-Service-Key" = "dev-context-service-key"
            "X-Acting-User-Id" = $userId
        } `
        -UseBasicParsing `
        -SkipHttpErrorCheck
    if ($forbiddenResponse.StatusCode -ne 403) {
        throw "INTERNAL caller allowlist did not block ContactContextService."
    }

    "Gateway proxy contract tests passed."
}
finally {
    $env:ASPNETCORE_ENVIRONMENT = $oldEnvironment
    $env:DOTNET_ENVIRONMENT = $oldDotnetEnvironment

    foreach ($process in $processes) {
        if (-not $process.HasExited) {
            Stop-Process -Id $process.Id -Force
        }
    }
}
