$ErrorActionPreference = "SilentlyContinue"

# ------------------------------------------------------------
# PATHS / STATE
# ------------------------------------------------------------

$base   = "$env:LOCALAPPDATA\DAUBE\PerformanceAutopilot"
$log    = "$base\autopilot.log"
$health = "$base\health.json"

$state = "NORMAL"

$lastStateChange = Get-Date
$lastHealth      = [datetime]::MinValue
$lastTempClean   = [datetime]::MinValue

$cpuHighCount = 0

# Minimum time before another RAM-state transition
$cooldownSeconds = 90


# ============================================================
# LOGGING
# ============================================================

function Rotate-Log {

    if (-not (Test-Path $log)) {
        return
    }

    $size = (Get-Item $log).Length

    # Rotate at ~2 MB
    if ($size -gt 2MB) {

        $old = "$base\autopilot-prev.log"

        Remove-Item $old -Force -ErrorAction SilentlyContinue
        Move-Item $log $old -Force -ErrorAction SilentlyContinue
    }
}

function Log([string]$message) {

    Rotate-Log

    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') | $message"

    Add-Content `
        -Path $log `
        -Value $line `
        -Encoding UTF8
}


# ============================================================
# MEMORY
# ============================================================

function Get-MemoryState {

    $os = Get-CimInstance Win32_OperatingSystem

    $total = $os.TotalVisibleMemorySize / 1MB
    $free  = $os.FreePhysicalMemory / 1MB
    $used  = $total - $free

    [pscustomobject]@{
        TotalGB = [math]::Round($total,2)
        FreeGB  = [math]::Round($free,2)
        UsedGB  = [math]::Round($used,2)
        UsedPct = [math]::Round(
            100 * $used / $total,
            1
        )
    }
}


# ============================================================
# CPU SAMPLE
# ============================================================

function Get-CPUUsage {

    $sample = Get-CimInstance Win32_Processor |
        Measure-Object LoadPercentage -Average

    return [math]::Round($sample.Average)
}


# ============================================================
# MEMORY SAFETY
# ============================================================

function Ensure-MemorySafety {

    try {
        $mma = Get-MMAgent

        if (-not $mma.MemoryCompression) {
            Enable-MMAgent -MemoryCompression

            Log "SELF-HEAL | Memory Compression restored"
        }
    }
    catch {}

    try {

        $cs = Get-CimInstance Win32_ComputerSystem

        if (-not $cs.AutomaticManagedPagefile) {

            Set-CimInstance `
                -InputObject $cs `
                -Property @{
                    AutomaticManagedPagefile = $true
                } |
                Out-Null

            Log "SELF-HEAL | System-managed pagefile restored"
        }

    }
    catch {}
}


# ============================================================
# OPERA CLASSIFICATION + TUNING
# ============================================================

function Tune-Opera {

    $operaProcesses = Get-CimInstance Win32_Process |
        Where-Object Name -eq "opera.exe"

    foreach ($item in $operaProcesses) {

        $proc = Get-Process `
            -Id $item.ProcessId `
            -ErrorAction SilentlyContinue

        if (-not $proc) {
            continue
        }

        $cmd = $item.CommandLine

        try {

            # Main browser
            if ($cmd -notmatch "--type=") {
                $proc.PriorityClass = "Normal"
            }

            # Keep GPU responsive
            elseif ($cmd -match "--type=gpu-process") {
                $proc.PriorityClass = "Normal"
            }

            # Tabs stay responsive
            elseif ($cmd -match "--type=renderer") {
                $proc.PriorityClass = "Normal"
            }

            # Background components can yield CPU
            elseif (
                $cmd -match "--extension-process" -or
                $cmd -match "--type=utility" -or
                $cmd -match "--type=crashpad"
            ) {
                $proc.PriorityClass = "BelowNormal"
            }

            else {
                $proc.PriorityClass = "BelowNormal"
            }
        }
        catch {}
    }
}


# ============================================================
# OPERA METRICS
# ============================================================

function Get-OperaMetrics {

    $rows = @()

    $cim = Get-CimInstance Win32_Process |
        Where-Object Name -eq "opera.exe"

    foreach ($item in $cim) {

        $p = Get-Process `
            -Id $item.ProcessId `
            -ErrorAction SilentlyContinue

        if (-not $p) {
            continue
        }

        $type = "Browser"

        if ($item.CommandLine -match "--type=gpu-process") {
            $type = "GPU"
        }
        elseif ($item.CommandLine -match "--extension-process") {
            $type = "Extension"
        }
        elseif ($item.CommandLine -match "--type=renderer") {
            $type = "Renderer"
        }
        elseif ($item.CommandLine -match "--type=utility") {
            $type = "Utility"
        }
        elseif ($item.CommandLine -match "--type=crashpad") {
            $type = "Crashpad"
        }
        elseif ($item.CommandLine -match "--type=") {
            $type = "Other"
        }

        $rows += [pscustomobject]@{
            Type   = $type
            RAM_MB = [math]::Round(
                $p.WorkingSet64 / 1MB
            )
        }
    }

    $operaRAM = (
        $rows |
        Measure-Object RAM_MB -Sum
    ).Sum

    $renderRAM = (
        $rows |
        Where-Object Type -eq "Renderer" |
        Measure-Object RAM_MB -Sum
    ).Sum

    $extRAM = (
        $rows |
        Where-Object Type -eq "Extension" |
        Measure-Object RAM_MB -Sum
    ).Sum

    $utilityRAM = (
        $rows |
        Where-Object Type -eq "Utility" |
        Measure-Object RAM_MB -Sum
    ).Sum

    [pscustomobject]@{
        Processes    = $rows.Count
        TotalRAM_MB  = [math]::Round($operaRAM)
        Renderer_MB  = [math]::Round($renderRAM)
        Extension_MB = [math]::Round($extRAM)
        Utility_MB   = [math]::Round($utilityRAM)
    }
}


# ============================================================
# OPTIONAL APPS
# ============================================================

function Close-OptionalApps {

    $optional = @(
        "Spotify",
        "SpotifyAB",
        "WhatsApp",
        "Teams",
        "MSTeams",
        "ms-teams",
        "PhoneExperienceHost",
        "YourPhone",
        "Widgets",
        "WidgetService",
        "Microsoft.CmdPal.UI",
        "GameBar",
        "GameBarFTServer",
        "XboxPcApp",
        "XboxGameBar"
    )

    foreach ($name in $optional) {

        $p = Get-Process `
            $name `
            -ErrorAction SilentlyContinue

        if (-not $p) {
            continue
        }

        $ram = [math]::Round(
            (($p |
                Measure-Object WorkingSet64 -Sum
            ).Sum / 1MB)
        )

        $p |
            Stop-Process `
            -Force `
            -ErrorAction SilentlyContinue

        Log "EMERGENCY | Closed optional $name | ${ram}MB"
    }
}


# ============================================================
# INDEXING
# ============================================================

function Handle-Indexing {

    if (
        Get-Process Everything `
            -ErrorAction SilentlyContinue
    ) {

        $service = Get-Service WSearch `
            -ErrorAction SilentlyContinue

        if ($service.Status -eq "Running") {

            Stop-Service `
                WSearch `
                -Force `
                -ErrorAction SilentlyContinue

            Log "PRESSURE | WSearch stopped because Everything is active"
        }
    }
}


# ============================================================
# BACKGROUND PRIORITIES
# ============================================================

function Reduce-BackgroundPriority {

    @(
        "Everything",
        "SearchIndexer"
    ) |
    ForEach-Object {

        Get-Process $_ `
            -ErrorAction SilentlyContinue |
            ForEach-Object {

                try {
                    $_.PriorityClass = "BelowNormal"
                }
                catch {}
            }
    }
}


# ============================================================
# RUNAWAY PROCESS DETECTOR
# Read-only for unknown apps.
# Does NOT kill random processes.
# ============================================================

function Detect-RunawayProcesses {

    $logical = (
        Get-CimInstance Win32_ComputerSystem
    ).NumberOfLogicalProcessors

    $before = @{}

    Get-Process |
    ForEach-Object {

        if ($null -ne $_.CPU) {
            $before[$_.Id] = $_.CPU
        }
    }

    Start-Sleep 5

    foreach ($p in Get-Process) {

        if (
            -not $before.ContainsKey($p.Id) -or
            $null -eq $p.CPU
        ) {
            continue
        }

        $delta = $p.CPU - $before[$p.Id]

        $pct = (
            $delta /
            5 /
            $logical *
            100
        )

        # Log sustained high per-process CPU.
        if ($pct -ge 25) {

            Log (
                "RUNAWAY? | " +
                "$($p.ProcessName) PID=$($p.Id) " +
                "CPU=$([math]::Round($pct,1))% " +
                "RAM=$([math]::Round($p.WorkingSet64/1MB))MB"
            )
        }
    }
}


# ============================================================
# RAM HYSTERESIS STATE MACHINE
#
# Enter:
#   L1 >= 85
#   L2 >= 90
#   L3 >= 94
#
# Exit uses LOWER boundaries:
#   L3 -> L2 below 91
#   L2 -> L1 below 87
#   L1 -> Normal below 82
# ============================================================

function Get-DesiredState(
    [double]$ram,
    [string]$current
) {

    switch ($current) {

        "NORMAL" {

            if ($ram -ge 94) { return "L3" }
            if ($ram -ge 90) { return "L2" }
            if ($ram -ge 85) { return "L1" }

            return "NORMAL"
        }

        "L1" {

            if ($ram -ge 94) { return "L3" }
            if ($ram -ge 90) { return "L2" }
            if ($ram -lt 82) { return "NORMAL" }

            return "L1"
        }

        "L2" {

            if ($ram -ge 94) { return "L3" }
            if ($ram -lt 87) { return "L1" }

            return "L2"
        }

        "L3" {

            if ($ram -lt 91) { return "L2" }

            return "L3"
        }
    }

    return "NORMAL"
}


# ============================================================
# HEALTH REPORT
# ============================================================

function Write-Health {

    $mem   = Get-MemoryState
    $cpu   = Get-CPUUsage
    $opera = Get-OperaMetrics

    $page = Get-CimInstance Win32_PageFileUsage |
        Select-Object -First 1

    $gpu = $null

    if (
        Get-Command nvidia-smi `
            -ErrorAction SilentlyContinue
    ) {

        try {

            $gpuRaw = nvidia-smi `
                --query-gpu=name,pstate,utilization.gpu,memory.used,memory.total `
                --format=csv,noheader,nounits

            $gpu = $gpuRaw
        }
        catch {}
    }

    $report = [ordered]@{
        Timestamp       = (Get-Date).ToString("o")
        AutopilotState  = $state

        CPUPercent      = $cpu

        RAM = @{
            UsedPercent = $mem.UsedPct
            FreeGB      = $mem.FreeGB
            TotalGB     = $mem.TotalGB
        }

        Opera = @{
            Processes    = $opera.Processes
            TotalRAM_MB  = $opera.TotalRAM_MB
            Renderer_MB  = $opera.Renderer_MB
            Extension_MB = $opera.Extension_MB
            Utility_MB   = $opera.Utility_MB
        }

        Pagefile = @{
            AllocatedMB = $page.AllocatedBaseSize
            CurrentMB   = $page.CurrentUsage
            PeakMB      = $page.PeakUsage
        }

        NVIDIA = $gpu
    }

    $report |
        ConvertTo-Json -Depth 5 |
        Set-Content `
            -Path $health `
            -Encoding UTF8
}


# ============================================================
# TEMP CLEANUP
# ============================================================

function Clean-OldTemp {

    if (
        (Get-Date) - $lastTempClean `
        -lt [timespan]::FromHours(12)
    ) {
        return
    }

    $cutoff = (Get-Date).AddDays(-7)

    Get-ChildItem `
        $env:TEMP `
        -Force `
        -ErrorAction SilentlyContinue |
    Where-Object {
        $_.LastWriteTime -lt $cutoff
    } |
    Remove-Item `
        -Recurse `
        -Force `
        -ErrorAction SilentlyContinue

    $script:lastTempClean = Get-Date

    Log "MAINTENANCE | Old TEMP cleanup complete"
}


# ============================================================
# START
# ============================================================

Log "=========================================="
Log "D'AUBE AUTOPILOT V2 START"
Log "=========================================="

Ensure-MemorySafety


# ============================================================
# MAIN LOOP
# ============================================================

while ($true) {

    try {

        Ensure-MemorySafety
        Tune-Opera

        $mem = Get-MemoryState
        $cpu = Get-CPUUsage

        # ----------------------------------------------------
        # CPU PRESSURE WATCHER
        # ----------------------------------------------------

        if ($cpu -ge 85) {
            $cpuHighCount++
        }
        else {
            $cpuHighCount = 0
        }

        if ($cpuHighCount -ge 3) {

            Reduce-BackgroundPriority

            Log "CPU PRESSURE | sustained >=85% | current=$cpu%"

            # Detect actual offender
            Detect-RunawayProcesses

            $cpuHighCount = 0
        }


        # ----------------------------------------------------
        # RAM STATE TRANSITION
        # ----------------------------------------------------

        $desired = Get-DesiredState `
            -ram $mem.UsedPct `
            -current $state

        if ($desired -ne $state) {

            $elapsed = (
                (Get-Date) - $lastStateChange
            ).TotalSeconds

            # Escalation is immediate.
            # De-escalation waits for cooldown.
            $escalating = (
                @("NORMAL","L1","L2","L3").IndexOf($desired) `
                -gt `
                @("NORMAL","L1","L2","L3").IndexOf($state)
            )

            if (
                $escalating -or
                $elapsed -ge $cooldownSeconds
            ) {

                Log (
                    "STATE | $state -> $desired | " +
                    "RAM=$($mem.UsedPct)%"
                )

                $state = $desired
                $lastStateChange = Get-Date
            }
        }


        # ----------------------------------------------------
        # ACTIONS
        # ----------------------------------------------------

        switch ($state) {

            "NORMAL" {

                # Lowest interference.
                Tune-Opera
            }


            "L1" {

                Reduce-BackgroundPriority
            }


            "L2" {

                Reduce-BackgroundPriority
                Handle-Indexing
            }


            "L3" {

                Reduce-BackgroundPriority
                Handle-Indexing
                Close-OptionalApps

                Log (
                    "EMERGENCY RAM | " +
                    "$($mem.UsedPct)% | " +
                    "Free=$($mem.FreeGB)GB"
                )
            }
        }


        # ----------------------------------------------------
        # MAINTENANCE
        # ----------------------------------------------------

        Clean-OldTemp


        # ----------------------------------------------------
        # HEALTH REPORT EVERY 5 MINUTES
        # ----------------------------------------------------

        if (
            (Get-Date) - $lastHealth `
            -ge [timespan]::FromMinutes(5)
        ) {

            Write-Health

            $lastHealth = Get-Date
        }


        # ----------------------------------------------------
        # COMPACT LOG STATUS
        # ----------------------------------------------------

        $opera = Get-OperaMetrics

        Log (
            "STATUS | " +
            "State=$state " +
            "RAM=$($mem.UsedPct)% " +
            "Free=$($mem.FreeGB)GB " +
            "CPU=$cpu% " +
            "Opera=$($opera.TotalRAM_MB)MB " +
            "Proc=$($opera.Processes)"
        )

    }
    catch {

        Log "LOOP ERROR | $($_.Exception.Message)"

        # self-healing pause
        Start-Sleep 10
    }


    # Main check interval
    Start-Sleep 30
}