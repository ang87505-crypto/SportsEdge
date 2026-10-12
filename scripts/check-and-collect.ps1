<#
    SportsEdge authenticated ingestion verification (Windows PowerShell 5.1+).
    Default: READ-ONLY connection probe, no Odds API calls and no writes.
    Pass -Collect only after the connection probe succeeds; this captures
    genuine current NBA/EPL odds (subject to provider availability/quota).
    The token is entered securely, held in process memory briefly, and never
    persisted to a file, console history, or a committed environment variable.
#>
param(
    [switch]$Collect,
    [ValidateSet("both","nba","soccer")][string]$Track = "both",
    [string]$Site = "https://sports-edge-eta.vercel.app"
)
$ErrorActionPreference = "Stop"
if ($Site -ne "https://sports-edge-eta.vercel.app") {
    throw "For safety, this script is restricted to the official SportsEdge production domain."
}
$secure = Read-Host "Paste your SPORTSEDGE_INGEST_TOKEN (hidden)" -AsSecureString
$handle = [IntPtr]::Zero
$token = $null
try {
    $handle = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($handle)
    if ($token.Length -lt 32) { throw "Token is shorter than 32 characters." }
    $headers = @{ Authorization = "Bearer $token"; Accept = "application/json" }
    Write-Host "Checking protected Supabase access (no provider cost, no writes)..."
    $probe = Invoke-RestMethod -Method Get -Uri "$Site/api/internal/collect-markets?probe=1" -Headers $headers -TimeoutSec 30 -UseBasicParsing
    if ($probe.status -ne "connected" -or $probe.sportsCount -lt 1) {
        throw "Probe did not confirm database connectivity. No data collection attempted."
    }
    Write-Host ("Supabase connected. Seeded sports: {0}" -f $probe.sportsCount)
    if ($Collect) {
        Write-Host ("Requested track: {0} (provider credits may be consumed after confirmation)." -f $Track)
        $preview = Invoke-RestMethod -Method Get -Uri "$Site/api/internal/collect-markets?plan=1&track=$Track" -Headers $headers -TimeoutSec 30 -UseBasicParsing
        if ($preview.status -ne "planned") { throw "Collection plan could not be verified; no provider request sent." }
        Write-Host ("Plan: {0} sportsbook provider HTTP request(s). Actual credits are not known from this plan." -f $preview.providerRequestsPlanned)
        $response = Read-Host "Type YES to authorize this single provider collection"
        if ($response -cne "YES") { Write-Host "Cancelled: no provider credits used."; return }
        Write-Host "Beginning the explicitly authorized collection..."
        $data = Invoke-RestMethod -Method Get -Uri "$Site/api/internal/collect-markets?collect=1&track=$Track" -Headers $headers -TimeoutSec 120 -UseBasicParsing
        if ($data.status -ne "completed") { throw "Ingestion did not report completion." }
        if ($data.tracks.nba) { Write-Host ("NBA: games processed={0}, odds inserted={1}" -f $data.tracks.nba.gamesProcessed, $data.tracks.nba.oddsInserted) }
        if ($data.tracks.soccer) { Write-Host ("EPL: games processed={0}, odds inserted={1}" -f $data.tracks.soccer.gamesProcessed, $data.tracks.soccer.oddsInserted) }
        Write-Host ("Remaining provider credit count (if supplied): {0}" -f $data.quotaRemaining)
        Write-Host "Use the Supabase dashboard to verify stored records and their timestamps."
    }
} catch {
    $status = $null
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
        $status = [int]$_.Exception.Response.StatusCode
    }
    if ($status) {
        Write-Error ("Protected request failed with HTTP {0}. 404 means token mismatch or route not found; 503 means configuration or provider/database error. Do not paste secrets into chat." -f $status)
    } else {
        Write-Error "The protected request failed. Verify the deployment and network; never paste the token into chat."
    }
    exit 1
} finally {
    $headers = $null
    $token = $null
    if ($handle -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($handle)
    }
}
