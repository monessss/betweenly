$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime] > $null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType=WindowsRuntime] > $null
[Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime] > $null
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
function Await-Result($operation, [Type]$resultType) {
    $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
    $task.Wait()
    return $task.Result
}
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
while ($null -ne ($request = [Console]::In.ReadLine())) {
    try {
        if ($null -eq $engine) { throw 'OCR is unavailable' }
        $stream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
        try {
            $writer = New-Object Windows.Storage.Streams.DataWriter($stream.GetOutputStreamAt(0))
            $writer.WriteBytes([Convert]::FromBase64String($request))
            $null = Await-Result ($writer.StoreAsync()) ([UInt32])
            $null = $writer.DetachStream(); $writer.Dispose(); $stream.Seek(0)
            $decoder = Await-Result ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
            $bitmap = Await-Result ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
            try {
                $result = Await-Result ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
                $lines = @($result.Lines | ForEach-Object {
                    $words = @($_.Words | ForEach-Object { @{text=$_.Text;x=$_.BoundingRect.X;y=$_.BoundingRect.Y;width=$_.BoundingRect.Width;height=$_.BoundingRect.Height} })
                    @{text=$_.Text;words=$words}
                })
                @{language=$engine.RecognizerLanguage.LanguageTag;lines=$lines} | ConvertTo-Json -Depth 8 -Compress
            } finally { $bitmap.Dispose() }
        } finally { $stream.Dispose() }
    } catch { '{"error":"OCR_UNAVAILABLE"}' }
}