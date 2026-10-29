param(
    [string]$InputCsv = (Join-Path $PSScriptRoot '../work/birdnet-taxonomy.csv'),
    [string]$Output = (Join-Path $PSScriptRoot '../dist/nature-catalog.json')
)

# Rebuild this pinned public-data snapshot; never downloads or edits the CSV.
# To update the source, verify its version/license and update the pinned hash/date.
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sourceCsvUrl = 'https://birdnet.cornell.edu/taxonomy/api/download/csv'
$sourceSha256 = 'DAECB2505FF16DDDBAFE76CFA8D15A044C506B6A2998B2349A94BCD355475AC4'
$version = 'v0.4-Oct2026'
$snapshotDate = '2026-10-29'
$sourceFile = [IO.Path]::GetFullPath($InputCsv)
$outputFile = [IO.Path]::GetFullPath($Output)
if ($sourceFile -eq $outputFile) { throw 'Output must differ from the source CSV.' }
if ((Get-FileHash -LiteralPath $sourceFile -Algorithm SHA256).Hash -ne $sourceSha256) {
    throw 'Source SHA256 does not match the pinned BirdNET snapshot; no output was written.'
}
$groupsFile = Join-Path $projectRoot 'dist/nature-groups.json'
if (!(Test-Path -LiteralPath $groupsFile -PathType Leaf)) { throw 'Build requires the verified dist/nature-groups.json supplement.' }
$groups = @(Get-Content -LiteralPath $groupsFile -Raw -Encoding UTF8 | ConvertFrom-Json)
function Test-PhotoLicense([string]$Value) {
    return $Value.Trim().ToLowerInvariant() -match '^(?:cc0|pd|cc-by(?:-nc)?(?:-sa)?)(?:[- ]\d+(?:\.\d+)?)?$'
}
function Test-PhotoSource([string]$Value, [string[]]$Hosts) {
    $uri = $null
    return [Uri]::TryCreate($Value, [UriKind]::Absolute, [ref]$uri) -and $uri.Scheme -eq 'https' -and $uri.Host -in $Hosts -and !$uri.UserInfo -and $uri.IsDefaultPort
}
$photoManifestFile = Join-Path $projectRoot 'dist/plant-assets/nature-photo-credits.json'
$photoManifestSha256 = ''
$photoOverrides = @{}
if (Test-Path -LiteralPath $photoManifestFile -PathType Leaf) {
    if ((Get-Item -LiteralPath $photoManifestFile).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Photo manifest must not be a symbolic link.' }
    $photoManifestSha256 = (Get-FileHash -LiteralPath $photoManifestFile -Algorithm SHA256).Hash
    $manifest = @(Get-Content -LiteralPath $photoManifestFile -Raw -Encoding UTF8 | ConvertFrom-Json)
    foreach ($photo in $manifest) {
        if ($photo.file -notmatch '^\d{1,15}\.jpg$' -or $photo.sha256 -notmatch '^[a-fA-F0-9]{64}$' -or !$photo.scientificName -or !$photo.author) { throw 'Photo manifest identity, filename, author or SHA256 is invalid.' }
        if (!(Test-PhotoLicense ([string]$photo.license)) -or !(Test-PhotoSource ([string]$photo.sourceUrl) @('birdnet.cornell.edu', 'static.avicommons.org', 'static.inaturalist.org', 'inaturalist-open-data.s3.amazonaws.com', 'upload.wikimedia.org'))) { throw 'Photo manifest license or source is unsupported.' }
        if ($photoOverrides.ContainsKey([string]$photo.scientificName)) { throw 'Duplicate scientific name in photo manifest.' }
        $photoFile = Join-Path $projectRoot ('dist/plant-assets/' + $photo.file)
        $info = Get-Item -LiteralPath $photoFile
        if ($info.PSIsContainer -or ($info.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $info.Length -gt 8MB -or (Get-FileHash -LiteralPath $photoFile -Algorithm SHA256).Hash -ne $photo.sha256) { throw 'Local photo SHA256, size or file type verification failed.' }
        $stream = [IO.File]::OpenRead($photoFile)
        try { if ($stream.ReadByte() -ne 255 -or $stream.ReadByte() -ne 216 -or $stream.ReadByte() -ne 255) { throw 'Local photo must contain JPEG bytes.' } } finally { $stream.Dispose() }
        $photoOverrides[[string]$photo.scientificName] = $photo
    }
}
$sourceRows = @(Import-Csv -LiteralPath $sourceFile -Encoding UTF8)
$species = @($sourceRows | Where-Object {
    $_.record_type -eq 'species' -and $_.taxon_group -in @('Aves', 'Mammalia', 'Insecta', 'Amphibia', 'Reptilia')
} | Sort-Object @{Expression={ [double]::Parse($_.commonness, [Globalization.CultureInfo]::InvariantCulture) }; Descending=$true}, scientific_name)
$records = [Collections.Generic.List[object]]::new()
foreach ($group in $groups) { $records.Add($group) }
$licensedPhotoCount = 0
$fallbackPhotoCount = 0
$localPhotoCount = 0
$chineseNameCount = 0
$kindCounts = [ordered]@{ bird = 0; animal = 0 }
foreach ($row in $species) {
    $scientific = $row.scientific_name.Trim()
    if (!$scientific) { throw 'A species row has no scientific name.' }
    $name = ''
    foreach ($value in @($row.'common_name_zh-CN', $row.common_name_zh, $row.common_name_en, $row.common_name, $scientific)) {
        if ($value -and $value.Trim()) { $name = $value.Trim(); break }
    }
    if ($name -match '\p{IsCJKUnifiedIdeographs}') { $chineseNameCount++ }
    $aliasSet = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $aliases = [Collections.Generic.List[string]]::new()
    # The inspected CSV uses | between multiple aliases. Do not split ordinary names on commas.
    foreach ($value in @($row.'common_name_zh-CN', $row.common_name_zh, $row.common_name_en, $row.common_name, $row.common_name_alt, $row.scientific_name_aliases, $row.common_name_aliases)) {
        foreach ($part in @($value -split '\|')) {
            if ($part -and $part.Trim()) {
                $alias = $part.Trim()
                if ($alias -ne $name -and $alias -ne $scientific -and $aliasSet.Add($alias)) { $aliases.Add($alias) }
            }
        }
    }
    $kind = if ($row.taxon_group -eq 'Aves') { 'bird' } else { 'animal' }
    $kindCounts[$kind]++
    $imageUrl = ''
    $imageAttribution = ''
    $license = ([string]$row.image_license).Trim().ToLowerInvariant()
    $author = ([string]$row.image_author).Trim()
    $licensed = Test-PhotoLicense $license
    $photoSource = [string]$row.image_url
    $imageSource = [string]$row.image_source
    $safePhoto = Test-PhotoSource $photoSource @('birdnet.cornell.edu')
    if (!$licensed -or !$author -or !$safePhoto) {
        $license = ([string]$row.avicommons_image_license).Trim().ToLowerInvariant()
        $author = ([string]$row.avicommons_image_author).Trim()
        $photoSource = [string]$row.avicommons_image_url
        $imageSource = 'Avicommons'
        $licensed = Test-PhotoLicense $license
        $safePhoto = Test-PhotoSource $photoSource @('static.avicommons.org')
        if ($licensed -and $author -and $safePhoto) { $fallbackPhotoCount++ }
    }
    if ($licensed -and $author -and $safePhoto) {
        $imageUrl = $photoSource
        $imageAttribution = "$author · $license · $imageSource · $photoSource"
    }
    if ($photoOverrides.ContainsKey($scientific)) {
        $photo = $photoOverrides[$scientific]
        $imageUrl = '/plant-assets/' + $photo.file
        $license = ([string]$photo.license).Trim().ToLowerInvariant()
        $imageSource = [string]$photo.imageSource
        $imageAttribution = "$($photo.author) · $license · $imageSource · $($photo.sourceUrl)"
        $localPhotoCount++
    }
    if ($imageUrl) { $licensedPhotoCount++ }
    $taxonId = if ($row.inat_id -match '^\d{1,15}$') { $row.inat_id } else { '' }
    $gbifKey = if ($row.gbif_id -match '^\d{1,15}$') { $row.gbif_id } else { '' }
    $records.Add([ordered]@{
        name = $name
        scientificName = $scientific
        aliases = @($aliases)
        kind = $kind
        taxonRank = 'species'
        taxonId = $taxonId
        gbifKey = $gbifKey
        sourceUrl = 'https://birdnet.cornell.edu/taxonomy/species/' + [Uri]::EscapeDataString($scientific)
        sourceLabel = 'Cornell BirdNET 离线名录 · ' + $version
        description = '离线名录参考，中文俗名不代表已确认原书物种，请核对。'
        imageUrl = $imageUrl
        imageLicense = $(if ($imageUrl) { $license } else { '' })
        imageSource = $(if ($imageUrl) { $imageSource } else { '' })
        imageAttribution = $imageAttribution
        offline = $true
    })
}
$catalog = [ordered]@{
    metadata = [ordered]@{
        version = $version
        snapshotDate = $snapshotDate
        sourceCsvUrl = $sourceCsvUrl
        sourceSha256 = $sourceSha256
        sourceHomepage = 'https://birdnet.cornell.edu/taxonomy/'
        license = 'MIT (taxonomy data); photographs retain individual attribution and licenses'
        photoLicenses = @('cc0', 'pd', 'cc-by', 'cc-by-sa', 'cc-by-nc', 'cc-by-nc-sa')
        sourceRowCount = $sourceRows.Count
        speciesCount = $species.Count
        groupCount = $groups.Count
        recordCount = $records.Count
        chineseNameCount = $chineseNameCount
        licensedPhotoCount = $licensedPhotoCount
        fallbackPhotoCount = $fallbackPhotoCount
        localPhotoCount = $localPhotoCount
        missingPhotoCount = $species.Count - $licensedPhotoCount
        photoManifestSha256 = $photoManifestSha256
        kindCounts = $kindCounts
        sourceUrls = @($sourceCsvUrl, 'https://birdnet.cornell.edu/taxonomy/', 'https://techdocs.gbif.org/en/openapi/v1/species')
    }
    records = @($records)
}
$json = $catalog | ConvertTo-Json -Depth 12 -Compress
$parent = [IO.Path]::GetDirectoryName($outputFile)
if (!(Test-Path -LiteralPath $parent -PathType Container)) { throw 'Output parent directory must already exist.' }
[IO.File]::WriteAllText($outputFile, $json, [Text.UTF8Encoding]::new($false))
Write-Output "Built $($records.Count) records ($($species.Count) species, $($groups.Count) groups); $licensedPhotoCount licensed photos."
