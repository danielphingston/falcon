$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech

$root      = 'D:\ToDo\video'
$storyPath = Join-Path $root 'storyboard.json'
$audioDir  = Join-Path $root 'out\audio'
$durPath   = Join-Path $root 'out\durations.json'

New-Item -ItemType Directory -Force -Path $audioDir | Out-Null

# Voice selection: en-IN, then en-GB, then Zira, then first English voice
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = $synth.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo }
$voice = $voices | Where-Object { $_.Culture.Name -eq 'en-IN' } | Select-Object -First 1
if (-not $voice) { $voice = $voices | Where-Object { $_.Culture.Name -eq 'en-GB' } | Select-Object -First 1 }
if (-not $voice) { $voice = $voices | Where-Object { $_.Name -eq 'Microsoft Zira Desktop' } | Select-Object -First 1 }
if (-not $voice) { $voice = $voices | Where-Object { $_.Culture.Name -like 'en-*' } | Select-Object -First 1 }
if (-not $voice) { throw 'No English voice installed.' }
$synth.SelectVoice($voice.Name)
$synth.Rate = 0
$synth.Volume = 100

$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(44100, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)

# Read WAV duration from header by walking RIFF chunks to the 'data' chunk
function Get-WavDuration([string]$path) {
    $bytes = [System.IO.File]::ReadAllBytes($path)
    $rate = [BitConverter]::ToUInt32($bytes, 28)   # byte rate (offset 28 in fmt chunk)
    $pos = 12
    while ($pos -lt $bytes.Length - 8) {
        $id = [System.Text.Encoding]::ASCII.GetString($bytes, $pos, 4)
        $size = [BitConverter]::ToUInt32($bytes, $pos + 4)
        if ($id -eq 'data') {
            return [math]::Round($size / $rate, 2)
        }
        $pos += 8 + $size + ($size % 2)
    }
    throw "No data chunk in $path"
}

$storyboard = Get-Content -Raw -Encoding UTF8 $storyPath | ConvertFrom-Json
$durations = [ordered]@{}

foreach ($scene in $storyboard.scenes) {
    $wav = Join-Path $audioDir ($scene.id + '.wav')
    $synth.SetOutputToWaveFile($wav, $format)
    $synth.Speak([string]$scene.narration)
    $synth.SetOutputToNull()
    $durations[$scene.id] = Get-WavDuration $wav
}
$synth.Dispose()

$durations['voice'] = $voice.Name
$json = $durations | ConvertTo-Json
[System.IO.File]::WriteAllText($durPath, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Output $json
