param(
    [string]$SourcePath = "C:/Users/smag1/Downloads/DEMO_02_04_2026.pptx",
    [string]$OutputPath = "C:/Users/smag1/Downloads/DEMO_02_04_2026_redesigned.pptx"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function ColorInt([string]$Hex) {
    $value = $Hex.Trim().TrimStart("#")
    $r = [Convert]::ToInt32($value.Substring(0, 2), 16)
    $g = [Convert]::ToInt32($value.Substring(2, 2), 16)
    $b = [Convert]::ToInt32($value.Substring(4, 2), 16)
    return ($r + ($g * 256) + ($b * 65536))
}

function SetFill($Shape, [string]$Hex, [double]$Transparency = 0) {
    $Shape.Fill.Visible = -1
    $Shape.Fill.Solid()
    $Shape.Fill.ForeColor.RGB = ColorInt $Hex
    $Shape.Fill.Transparency = $Transparency
}

function HideFill($Shape) {
    $Shape.Fill.Visible = 0
}

function SetLine($Shape, [string]$Hex, [double]$Weight = 1, [double]$Transparency = 0) {
    $Shape.Line.Visible = -1
    $Shape.Line.ForeColor.RGB = ColorInt $Hex
    $Shape.Line.Weight = $Weight
    $Shape.Line.Transparency = $Transparency
}

function HideLine($Shape) {
    $Shape.Line.Visible = 0
}

function SetTextBox(
    $Shape,
    [string]$FontName = "Segoe UI",
    [double]$FontSize = 16,
    [string]$Color = "1E2A44",
    [bool]$Bold = $false,
    [int]$Alignment = 1
) {
    if (-not ($Shape.HasTextFrame -and $Shape.TextFrame.HasText)) {
        return
    }

    $range = $Shape.TextFrame.TextRange
    $range.Font.Name = $FontName
    $range.Font.Size = $FontSize
    $range.Font.Color.RGB = ColorInt $Color
    $range.Font.Bold = if ($Bold) { -1 } else { 0 }
    $range.ParagraphFormat.Alignment = $Alignment

    try {
        $Shape.TextFrame.MarginLeft = 0
        $Shape.TextFrame.MarginRight = 0
        $Shape.TextFrame.MarginTop = 0
        $Shape.TextFrame.MarginBottom = 0
    } catch {
    }
}

function StyleParagraph(
    $Shape,
    [int]$Index,
    [string]$FontName,
    [double]$FontSize,
    [string]$Color,
    [bool]$Bold = $false,
    $Alignment = $null
) {
    $paragraph = $Shape.TextFrame.TextRange.Paragraphs($Index)
    $paragraph.Font.Name = $FontName
    $paragraph.Font.Size = $FontSize
    $paragraph.Font.Color.RGB = ColorInt $Color
    $paragraph.Font.Bold = if ($Bold) { -1 } else { 0 }
    if ($null -ne $Alignment) {
        $paragraph.ParagraphFormat.Alignment = [int]$Alignment
    }
}

function SetSlideBackground($Slide, [string]$Hex) {
    $Slide.FollowMasterBackground = 0
    $Slide.Background.Fill.Visible = -1
    $Slide.Background.Fill.Solid()
    $Slide.Background.Fill.ForeColor.RGB = ColorInt $Hex
}

function AddDecorativeOrbs($Slide, [string]$Primary, [string]$Secondary) {
    $orb1 = $Slide.Shapes.AddShape(9, 590, -45, 180, 180)
    SetFill $orb1 $Primary 0.88
    HideLine $orb1
    $orb1.ZOrder(1)

    $orb2 = $Slide.Shapes.AddShape(9, -55, 300, 160, 160)
    SetFill $orb2 $Secondary 0.92
    HideLine $orb2
    $orb2.ZOrder(1)
}

function StyleTitle($Shape) {
    $Shape.Left = 36
    $Shape.Top = 18
    $Shape.Width = 620
    $Shape.Height = 44
    SetTextBox $Shape "Segoe UI Semibold" 28 "1D2940" $true 1
}

function StyleSubtitle($Shape) {
    SetTextBox $Shape "Segoe UI" 12 "67758C" $false 1
}

function StyleCard($Shape, [string]$FillHex = "FFFFFF", [string]$LineHex = "E4EAF4") {
    try {
        if ($Shape.Type -eq 1) {
            $Shape.AutoShapeType = 5
        }
    } catch {
    }
    SetFill $Shape $FillHex
    SetLine $Shape $LineHex 1 0
    try {
        $Shape.Shadow.Visible = 0
    } catch {
    }
}

function StyleChip($Shape, [string]$FillHex, [string]$TextHex) {
    StyleCard $Shape $FillHex $FillHex
    SetTextBox $Shape "Segoe UI Semibold" 12 $TextHex $true 2
}

function FormatLineChart($ChartShape) {
    $chart = $ChartShape.Chart
    $chart.ChartArea.Format.Fill.Visible = 0
    $chart.ChartArea.Format.Line.Visible = 0
    $chart.PlotArea.Format.Fill.Visible = 0
    $chart.PlotArea.Format.Line.Visible = 0
    $chart.Legend.Font.Name = "Segoe UI"
    $chart.Legend.Font.Size = 10
    $chart.Legend.Font.Color = ColorInt "66758C"

    $categoryAxis = $chart.Axes(1)
    $valueAxis = $chart.Axes(2)
    $categoryAxis.TickLabels.Font.Name = "Segoe UI"
    $categoryAxis.TickLabels.Font.Size = 10
    $categoryAxis.TickLabels.Font.Color = ColorInt "66758C"
    $valueAxis.TickLabels.Font.Name = "Segoe UI"
    $valueAxis.TickLabels.Font.Size = 10
    $valueAxis.TickLabels.Font.Color = ColorInt "66758C"
    $valueAxis.MajorGridlines.Format.Line.ForeColor.RGB = ColorInt "D9E2F0"
    $valueAxis.MajorGridlines.Format.Line.Transparency = 0.1

    $seriesColors = @("437EF7", "7A5AF8", "F59E0B", "FF5A5F")
    for ($i = 1; $i -le $chart.SeriesCollection().Count; $i++) {
        $series = $chart.SeriesCollection($i)
        $series.Format.Line.ForeColor.RGB = ColorInt $seriesColors[$i - 1]
        $series.Format.Line.Weight = 2.25
        $series.MarkerBackgroundColor = ColorInt $seriesColors[$i - 1]
        $series.MarkerForegroundColor = ColorInt $seriesColors[$i - 1]
        $series.MarkerSize = 7
    }
}

function FormatColumnChart($ChartShape) {
    $chart = $ChartShape.Chart
    $chart.ChartArea.Format.Fill.Visible = 0
    $chart.ChartArea.Format.Line.Visible = 0
    $chart.PlotArea.Format.Fill.Visible = 0
    $chart.PlotArea.Format.Line.Visible = 0
    $chart.Legend.Font.Name = "Segoe UI"
    $chart.Legend.Font.Size = 10
    $chart.Legend.Font.Color = ColorInt "66758C"

    $categoryAxis = $chart.Axes(1)
    $valueAxis = $chart.Axes(2)
    $categoryAxis.TickLabels.Font.Name = "Segoe UI"
    $categoryAxis.TickLabels.Font.Size = 10
    $categoryAxis.TickLabels.Font.Color = ColorInt "66758C"
    $valueAxis.TickLabels.Font.Name = "Segoe UI"
    $valueAxis.TickLabels.Font.Size = 10
    $valueAxis.TickLabels.Font.Color = ColorInt "66758C"
    $valueAxis.MajorGridlines.Format.Line.ForeColor.RGB = ColorInt "D9E2F0"
    $valueAxis.MajorGridlines.Format.Line.Transparency = 0.1

    $chart.SeriesCollection(1).Format.Fill.ForeColor.RGB = ColorInt "437EF7"
    $chart.SeriesCollection(1).Format.Line.Visible = 0
    $chart.SeriesCollection(2).Format.Fill.ForeColor.RGB = ColorInt "16A394"
    $chart.SeriesCollection(2).Format.Line.Visible = 0
}

function FormatTable($TableShape) {
    $table = $TableShape.Table

    for ($row = 1; $row -le $table.Rows.Count; $row++) {
        for ($col = 1; $col -le $table.Columns.Count; $col++) {
            $cell = $table.Cell($row, $col)
            $cell.Shape.TextFrame.TextRange.Font.Name = "Segoe UI"
            $cell.Shape.TextFrame.TextRange.Font.Size = 10
            $cell.Shape.TextFrame.TextRange.Font.Color.RGB = ColorInt "31405C"
            $cell.Shape.Fill.ForeColor.RGB = ColorInt "FFFFFF"
            $cell.Borders(1).ForeColor.RGB = ColorInt "E4EAF4"
            $cell.Borders(2).ForeColor.RGB = ColorInt "E4EAF4"
            $cell.Borders(3).ForeColor.RGB = ColorInt "E4EAF4"
            $cell.Borders(4).ForeColor.RGB = ColorInt "E4EAF4"
        }
    }

    for ($col = 1; $col -le $table.Columns.Count; $col++) {
        $headerCell = $table.Cell(1, $col)
        $headerCell.Shape.Fill.ForeColor.RGB = ColorInt "1F2F56"
        $headerCell.Shape.TextFrame.TextRange.Font.Color.RGB = ColorInt "FFFFFF"
        $headerCell.Shape.TextFrame.TextRange.Font.Bold = -1
        $headerCell.Shape.TextFrame.TextRange.Font.Size = 8
    }

    $table.Columns.Item(1).Width = 54
    $table.Columns.Item(2).Width = 32
    $table.Columns.Item(3).Width = 32
    $table.Columns.Item(4).Width = 50
    $table.Columns.Item(5).Width = 37.2

    for ($row = 2; $row -le $table.Rows.Count; $row++) {
        $monthCell = $table.Cell($row, 1)
        $monthCell.Shape.Fill.ForeColor.RGB = ColorInt "F5F8FD"
        $monthCell.Shape.TextFrame.TextRange.Font.Bold = -1
        $monthCell.Shape.TextFrame.TextRange.Font.Size = 9
    }

    for ($col = 1; $col -le $table.Columns.Count; $col++) {
        $marchCell = $table.Cell(6, $col)
        $marchCell.Shape.Fill.ForeColor.RGB = ColorInt "EAF6F3"
        $marchCell.Shape.TextFrame.TextRange.Font.Bold = -1
    }
}

if (-not (Test-Path $SourcePath)) {
    throw "Source presentation not found: $SourcePath"
}

$outputDir = Split-Path -Parent $OutputPath
if (-not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
}

Copy-Item -LiteralPath $SourcePath -Destination $OutputPath -Force

$ppt = $null
$presentation = $null

try {
    $ppt = New-Object -ComObject PowerPoint.Application
    $ppt.Visible = -1
    $presentation = $ppt.Presentations.Open($OutputPath, $false, $false, $false)

    $lightSlides = 1..5
    foreach ($slideIndex in $lightSlides) {
        $slide = $presentation.Slides.Item($slideIndex)
        SetSlideBackground $slide "F6F8FC"
        AddDecorativeOrbs $slide "2F6FED" "12B6A8"
    }

    $slide1 = $presentation.Slides.Item(1)
    StyleTitle $slide1.Shapes.Item("Text 0")
    StyleCard $slide1.Shapes.Item("Shape 1")
    StyleCard $slide1.Shapes.Item("Shape 3")
    SetTextBox $slide1.Shapes.Item("Text 2") "Segoe UI Semibold" 13 "1D2940" $true 1
    SetTextBox $slide1.Shapes.Item("Text 4") "Segoe UI Semibold" 13 "1D2940" $true 1
    SetTextBox $slide1.Shapes.Item("Text 5") "Segoe UI Semibold" 13 "1D2940" $true 1
    FormatLineChart $slide1.Shapes.Item("Chart 0")
    FormatTable $slide1.Shapes.Item("Table 0")

    $deltaRows = @(
        @{ Row = "Shape 6"; Label = "Text 7"; Value = "Text 8"; Chip = "Shape 9"; ChipText = "Text 10"; Fill = "EAF7EF"; Text = "109868" },
        @{ Row = "Shape 11"; Label = "Text 12"; Value = "Text 13"; Chip = "Shape 14"; ChipText = "Text 15"; Fill = "EAF7EF"; Text = "109868" },
        @{ Row = "Shape 16"; Label = "Text 17"; Value = "Text 18"; Chip = "Shape 19"; ChipText = "Text 20"; Fill = "FFF1F0"; Text = "D64545" },
        @{ Row = "Shape 21"; Label = "Text 22"; Value = "Text 23"; Chip = "Shape 24"; ChipText = "Text 25"; Fill = "EEF2F8"; Text = "596780" }
    )
    foreach ($item in $deltaRows) {
        StyleCard $slide1.Shapes.Item($item.Row) "FFFFFF" "E6ECF5"
        SetTextBox $slide1.Shapes.Item($item.Label) "Segoe UI Semibold" 12 "1D2940" $true 1
        SetTextBox $slide1.Shapes.Item($item.Value) "Segoe UI" 11 "67758C" $false 1
        StyleChip $slide1.Shapes.Item($item.Chip) $item.Fill $item.Text
        SetTextBox $slide1.Shapes.Item($item.ChipText) "Segoe UI Semibold" 11 $item.Text $true 2
    }

    $slide2 = $presentation.Slides.Item(2)
    StyleTitle $slide2.Shapes.Item("Text 0")
    StyleChip $slide2.Shapes.Item("Shape 1") "1F2F56" "FFFFFF"
    SetTextBox $slide2.Shapes.Item("Text 2") "Segoe UI Semibold" 11 "FFFFFF" $true 2
    SetTextBox $slide2.Shapes.Item("Text 3") "Segoe UI Semibold" 10 "6A7A92" $true 1
    SetTextBox $slide2.Shapes.Item("Text 14") "Segoe UI Semibold" 10 "6A7A92" $true 1

    StyleCard $slide2.Shapes.Item("Shape 4") "FFFFFF" "E4EAF4"
    StyleCard $slide2.Shapes.Item("Shape 9") "FFFFFF" "E4EAF4"
    SetTextBox $slide2.Shapes.Item("Text 5") "Segoe UI Semibold" 16 "1D2940" $true 1
    SetTextBox $slide2.Shapes.Item("Text 6") "Segoe UI" 11 "67758C" $false 1
    SetTextBox $slide2.Shapes.Item("Text 10") "Segoe UI Semibold" 16 "1D2940" $true 1
    SetTextBox $slide2.Shapes.Item("Text 11") "Segoe UI" 11 "67758C" $false 1
    StyleChip $slide2.Shapes.Item("Shape 7") "EAF7EF" "109868"
    StyleChip $slide2.Shapes.Item("Shape 12") "FFF1F0" "D64545"
    SetTextBox $slide2.Shapes.Item("Text 8") "Segoe UI Semibold" 12 "109868" $true 2
    SetTextBox $slide2.Shapes.Item("Text 13") "Segoe UI Semibold" 12 "D64545" $true 2

    foreach ($index in 15, 17, 19, 21, 23, 25, 27) {
        StyleCard $slide2.Shapes.Item("Shape $index") "FBFCFF" "E4EAF4"
    }
    foreach ($index in 16, 18, 20, 22, 24, 26, 28) {
        SetTextBox $slide2.Shapes.Item("Text $index") "Segoe UI" 12 "31405C" $false 1
    }

    $slide3 = $presentation.Slides.Item(3)
    StyleTitle $slide3.Shapes.Item("Text 0")
    StyleSubtitle $slide3.Shapes.Item("Text 1")
    SetTextBox $slide3.Shapes.Item("Text 2") "Segoe UI Semibold" 15 "1D2940" $true 1
    SetTextBox $slide3.Shapes.Item("Text 3") "Segoe UI Semibold" 17 "1D2940" $true 1
    SetTextBox $slide3.Shapes.Item("Text 6") "Segoe UI Semibold" 15 "1D2940" $true 1
    SetTextBox $slide3.Shapes.Item("Text 7") "Segoe UI Semibold" 17 "1D2940" $true 1
    SetTextBox $slide3.Shapes.Item("Text 10") "Segoe UI Semibold" 15 "1D2940" $true 1
    SetTextBox $slide3.Shapes.Item("Text 11") "Segoe UI Semibold" 17 "1D2940" $true 1

    foreach ($shapeName in "Shape 4", "Shape 8", "Shape 12") {
        StyleCard $slide3.Shapes.Item($shapeName) "DDE5F1" "DDE5F1"
    }
    StyleCard $slide3.Shapes.Item("Shape 5") "437EF7" "437EF7"
    StyleCard $slide3.Shapes.Item("Shape 9") "7A5AF8" "7A5AF8"
    StyleCard $slide3.Shapes.Item("Shape 13") "16A394" "16A394"

    StyleCard $slide3.Shapes.Item("Shape 14") "1F2F56" "1F2F56"
    foreach ($index in 15, 16, 18, 20, 22) {
        SetTextBox $slide3.Shapes.Item("Text $index") "Segoe UI" 11 "C5D0E2" $false 1
    }
    foreach ($index in 17, 19, 21) {
        SetTextBox $slide3.Shapes.Item("Text $index") "Segoe UI Semibold" 24 "FFFFFF" $true 1
    }

    $slide4 = $presentation.Slides.Item(4)
    StyleTitle $slide4.Shapes.Item("Text 0")
    StyleSubtitle $slide4.Shapes.Item("Text 1")
    StyleCard $slide4.Shapes.Item("Shape 2") "EEF3FB" "EEF3FB"
    SetTextBox $slide4.Shapes.Item("Text 3") "Segoe UI" 10 "5C6C85" $false 1
    StyleCard $slide4.Shapes.Item("Shape 4")
    SetTextBox $slide4.Shapes.Item("Text 5") "Segoe UI Semibold" 13 "1D2940" $true 1
    FormatColumnChart $slide4.Shapes.Item("Chart 0")
    SetTextBox $slide4.Shapes.Item("Text 6") "Segoe UI Semibold" 13 "1D2940" $true 1

    foreach ($shapeName in "Shape 7", "Shape 11", "Shape 15") {
        StyleCard $slide4.Shapes.Item($shapeName) "FFFFFF" "E4EAF4"
    }
    foreach ($index in 8, 12, 16) {
        SetTextBox $slide4.Shapes.Item("Text $index") "Segoe UI Semibold" 16 "1D2940" $true 1
    }
    foreach ($index in 9, 13, 17) {
        SetTextBox $slide4.Shapes.Item("Text $index") "Segoe UI Semibold" 22 "109868" $true 2
    }
    foreach ($index in 10, 14, 18) {
        SetTextBox $slide4.Shapes.Item("Text $index") "Segoe UI" 10 "66758C" $false 1
    }

    $slide5 = $presentation.Slides.Item(5)
    StyleTitle $slide5.Shapes.Item("Text 0")
    StyleCard $slide5.Shapes.Item("Shape 1") "EEF4FF" "D6E2FA"
    StyleCard $slide5.Shapes.Item("Shape 7") "F0FBF7" "D7F0E7"
    HideLine $slide5.Shapes.Item("Shape 3")
    HideLine $slide5.Shapes.Item("Shape 9")
    SetTextBox $slide5.Shapes.Item("Text 2") "Segoe UI Semibold" 16 "1D2940" $true 2
    SetTextBox $slide5.Shapes.Item("Text 8") "Segoe UI Semibold" 16 "1D2940" $true 1

    $slide5.Shapes.Item("Text 4").TextFrame.TextRange.Text = "All remaining farms`r`nhave been onboarded to Rotary"
    SetTextBox $slide5.Shapes.Item("Text 4") "Segoe UI Semibold" 16 "109868" $true 2

    StyleCard $slide5.Shapes.Item("Shape 5") "16A34A" "16A34A"
    SetTextBox $slide5.Shapes.Item("Text 6") "Segoe UI Semibold" 28 "FFFFFF" $true 2

    $slide5.Shapes.Item("Text 10").TextFrame.TextRange.Text = "Preparation time reduced on Aggression`r`nEstimated monthly savings`r`n~`$1.1K"
    SetTextBox $slide5.Shapes.Item("Text 10") "Segoe UI" 14 "31405C" $false 1
    StyleParagraph $slide5.Shapes.Item("Text 10") 1 "Segoe UI" 14 "31405C" $false 1
    StyleParagraph $slide5.Shapes.Item("Text 10") 2 "Segoe UI Semibold" 13 "109868" $true 1
    StyleParagraph $slide5.Shapes.Item("Text 10") 3 "Segoe UI Semibold" 24 "109868" $true 1

    $slide6 = $presentation.Slides.Item(6)
    SetSlideBackground $slide6 "1F2F56"
    AddDecorativeOrbs $slide6 "5AA5FF" "16A394"
    StyleTitle $slide6.Shapes.Item("Text 0")
    SetTextBox $slide6.Shapes.Item("Text 0") "Segoe UI Semibold" 32 "FFFFFF" $true 2
    $slide6.Shapes.Item("Text 0").Top = 78
    $slide6.Shapes.Item("Text 0").Height = 50

    $speakerCard = $slide6.Shapes.AddShape(5, 168, 172, 384, 160)
    SetFill $speakerCard "FFFFFF" 0.88
    HideLine $speakerCard
    $speakerCard.ZOrder(1)

    SetTextBox $slide6.Shapes.Item("Text 1") "Segoe UI Semibold" 13 "AFC7F7" $true 2
    $slide6.Shapes.Item("Text 1").Top = 190

    $slide6.Shapes.Item("Text 2").TextFrame.TextRange.Text = "1. Leonid - Aggression`r`n2. Tatiana - IP`r`n3. Anna - RQ`r`n4. Nazim - QA / BPO"
    SetTextBox $slide6.Shapes.Item("Text 2") "Segoe UI" 15 "EAF0FA" $false 2
    $slide6.Shapes.Item("Text 2").Top = 216
    $slide6.Shapes.Item("Text 2").Height = 100

    $presentation.Save()
    $presentation.Close()
    $ppt.Quit()
} catch {
    if ($presentation -ne $null) {
        try { $presentation.Close() } catch {}
    }
    if ($ppt -ne $null) {
        try { $ppt.Quit() } catch {}
    }
    throw
}

Write-Output "Saved redesigned presentation to $OutputPath"
