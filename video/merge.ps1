param([double]$Gain = 0)
# Builds FDD-Tracker-feature-tour.mp4, the SRT subtitles and review frames.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File D:\ToDo\video\merge.ps1 [-Gain <dB>]
$ErrorActionPreference = 'Stop'
$inv = [Globalization.CultureInfo]::InvariantCulture
$utf8 = New-Object System.Text.UTF8Encoding($false)
function F([double]$x) { $x.ToString('F3', $inv) }

$root   = 'D:\ToDo\video'
$out    = Join-Path $root 'out'
$frames = Join-Path $out 'frames'
$raw    = Join-Path $out 'raw.webm'
$mp4    = Join-Path $out 'FDD-Tracker-feature-tour.mp4'
$srt    = Join-Path $out 'FDD-Tracker-feature-tour.srt'
$filterFile = Join-Path $out 'FDD-Tracker-filter.txt'

# Tool paths: line 1 = ffmpeg, line 2 = ffprobe
$tools   = Get-Content (Join-Path $out 'ffmpeg-path.txt') -Encoding UTF8
$ffmpeg  = $tools[0].Trim()
$ffprobe = $tools[1].Trim()

$ts   = Get-Content (Join-Path $out 'timestamps.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$durs = Get-Content (Join-Path $out 'durations.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$sb   = Get-Content (Join-Path $root 'storyboard.json') -Raw -Encoding UTF8 | ConvertFrom-Json

$narr = @{}
foreach ($s in $sb.scenes) { $narr[[string]$s.id] = [string]$s.narration }

$T0 = [double]$ts.'01-intro'
$rawProbe = (& $ffprobe -v error -show_entries format=duration -of csv=p=0 $raw) | Select-Object -First 1
$rawDur = [double]::Parse($rawProbe.Trim(), $inv)
$E = [Math]::Min([double]$ts.end + 0.5, $rawDur)
$D = $E - $T0
$sceneIds = @($ts.PSObject.Properties.Name | Where-Object { $_ -ne 'end' })
$N = $sceneIds.Count
Write-Host ("T0={0} E={1} D={2} scenes={3} gain={4}dB" -f (F $T0), (F $E), (F $D), $N, $Gain)

# ---- filter graph ----
$inArgs = @('-i', $raw)
$chains = New-Object System.Collections.Generic.List[string]
$mixLabels = New-Object System.Collections.Generic.List[string]
$chains.Add(('[0:v]trim=start={0}:end={1},setpts=PTS-STARTPTS,fps=30,fade=t=in:st=0:d=0.6,fade=t=out:st={2}:d=1.0,format=yuv420p[v]' -f (F $T0), (F $E), (F ($D - 1.0))))
$i = 1
foreach ($id in $sceneIds) {
    $wav = Join-Path $out ("audio\$id.wav")
    $inArgs += @('-i', $wav)
    $delayMs = [int][Math]::Round(([double]$ts.$id - $T0) * 1000)
    $chains.Add(('[{0}:a]aresample=48000,adelay={1}:all=1[a{0}]' -f $i, $delayMs))
    $mixLabels.Add("[a$i]")
    $i++
}
$volFilter = ''
if ($Gain -ne 0) { $volFilter = ',volume=' + (F $Gain) + 'dB' }
$chains.Add(('{0}amix=inputs={1}:normalize=0:dropout_transition=0,apad,atrim=end={2},asetpts=N/SR/TB,afade=t=in:st=0:d=0.6,afade=t=out:st={3}:d=1.0{4},aresample=48000[a]' -f ($mixLabels -join ''), $N, (F $D), (F ($D - 1.0)), $volFilter))
[System.IO.File]::WriteAllText($filterFile, ($chains -join ";`n"), $utf8)

# ---- encode ----
$ffArgs = @('-hide_banner', '-y') + $inArgs + @(
    '-/filter_complex', $filterFile,
    '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-r', '30',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000',
    '-t', (F $D), '-movflags', '+faststart', $mp4)
& $ffmpeg @ffArgs
if ($LASTEXITCODE -ne 0) { throw "ffmpeg failed with exit code $LASTEXITCODE" }

# ---- SRT ----
function Fmt-Srt([double]$sec) {
    $ms = [int][Math]::Round($sec * 1000)
    $h = [int][Math]::Floor($ms / 3600000)
    $m = [int][Math]::Floor(($ms % 3600000) / 60000)
    $s = [int][Math]::Floor(($ms % 60000) / 1000)
    $r = $ms % 1000
    return ('{0:D2}:{1:D2}:{2:D2},{3:D3}' -f $h, $m, $s, $r)
}
function Wrap-Lines([string]$text, [int]$width = 80) {
    $words = @($text -split '\s+' | Where-Object { $_ -ne '' })
    $lines = New-Object System.Collections.Generic.List[string]
    $cur = ''
    foreach ($w in $words) {
        if ($cur -eq '') { $cur = $w }
        elseif (($cur.Length + 1 + $w.Length) -le $width) { $cur = "$cur $w" }
        else { $lines.Add($cur); $cur = $w }
    }
    if ($cur -ne '') { $lines.Add($cur) }
    return , $lines.ToArray()
}

$cues = New-Object System.Collections.ArrayList
foreach ($id in $sceneIds) {
    if (-not $narr.ContainsKey($id)) { Write-Warning "No narration for $id"; continue }
    $start0 = [double]$ts.$id - $T0
    $dur = [double]$durs.$id
    $lines = Wrap-Lines $narr[$id] 80
    # group wrapped lines into cues of at most 2 lines each
    $groups = New-Object System.Collections.Generic.List[object]
    for ($k = 0; $k -lt $lines.Count; $k += 2) {
        $g = @($lines[$k])
        if ($k + 1 -lt $lines.Count) { $g += $lines[$k + 1] }
        $groups.Add($g)
    }
    $wc = @($groups | ForEach-Object { @(($_ -join ' ') -split '\s+').Count })
    $total = ($wc | Measure-Object -Sum).Sum
    $cursor = $start0
    for ($gi = 0; $gi -lt $groups.Count; $gi++) {
        $len = $dur * $wc[$gi] / $total
        $end = $cursor + $len
        if ($gi -eq $groups.Count - 1) { $end = $start0 + $dur }
        [void]$cues.Add([pscustomobject]@{ Start = $cursor; End = $end; Text = (($groups[$gi]) -join "`n") })
        $cursor = $end
    }
}
$sbText = New-Object System.Text.StringBuilder
$n = 1
foreach ($c in $cues) {
    [void]$sbText.Append("$n`n" + (Fmt-Srt $c.Start) + ' --> ' + (Fmt-Srt $c.End) + "`n" + $c.Text + "`n`n")
    $n++
}
[System.IO.File]::WriteAllText($srt, $sbText.ToString(), $utf8)
Write-Host "Wrote $($cues.Count) SRT cues to $srt"

# ---- review frames from the final MP4 ----
New-Item -ItemType Directory -Force -Path $frames | Out-Null
$frameIds = @('01-intro', '03-today', '04-quickadd', '05-complete', '08-import', '10-irl', '11-workpapers', '13-calendar', '16-assistant', '18-install')
foreach ($id in $frameIds) {
    $mid = ([double]$ts.$id - $T0) + ([double]$durs.$id) / 2
    & $ffmpeg -hide_banner -loglevel error -y -ss (F $mid) -i $mp4 -frames:v 1 -vf 'scale=960:-2' (Join-Path $frames "$id.png")
    if ($LASTEXITCODE -ne 0) { throw "frame extraction failed for $id" }
}
Write-Host "Done."
