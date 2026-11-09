# Design brief: Paris & Suburbs Property Sales

This brief describes how the dashboard works and looks after the redesign of November 2026 (branch `ui-redesign`, guide `docs/paris-sales-redesign-TRANSPLANT.md`), so that a designer can propose further changes to its UI and UX. Section 11 lists the rough spots that are still open. Section 12 lists what any redesign must keep.

## 1. What the site is

The site shows what homes in Paris and its suburbs have sold for, and how prices have moved. The figures come from DVF, the French tax administration's open data on property sales. The site will be public, and it is not launched yet.

**Who uses it:** home buyers and residents of Paris and its suburbs. They are not analysts. They want to answer questions such as these:
- What do flats sell for in my quartier?
- Is my area cheaper than the one next to it?
- Did prices rise or fall over the last two years?
- Which sales happened on my street?

**What the site never does:** it never gives a Valuation, which is an estimate of what one specific home is worth. It describes past Sales, and the judgement stays with the Visitor.

**Vocabulary.** The site uses these terms consistently, in the interface and in the code:

| Term | Meaning |
| --- | --- |
| Sale | One recorded sale of one apartment or house |
| Area | All of Paris, one Department, one Arrondissement, one Quartier or one Commune |
| Arrondissement | One of Paris's 20 divisions |
| Quartier | One of Paris's 80 subdivisions, 4 in each Arrondissement |
| Commune | One town outside Paris |
| Department | Hauts-de-Seine, Seine-Saint-Denis or Val-de-Marne |
| Major town | A larger Commune outside those three Departments |
| Period | The dates the Visitor has chosen |
| Selection | A property type (all, apartments or houses), an Area and a Period, taken together. Every panel describes the Sales in the current Selection. |
| Price per m² | The price divided by the built surface |
| Change | The percentage difference between the median Price per m² at the start and at the end of the Period |

The interface is in English and in French. A Visitor switches with the EN | FR control in the masthead. The French text uses the French terms in `CONTEXT.md`.

## 2. The page as a whole

The site is one long page with a centred column at most 1440 px wide. The page answers first, then compares. From top to bottom it holds:

1. **Masthead.** On the left are the title, "Paris & Suburbs Property Sales", and the coverage, "Data to {month}". From 768 px wide it adds ", {month} release". On the right, from 768 px wide, are two rows aligned right. The first row is the author line in 13 px muted text: "by Sagar Pal · ★ Star on GitHub". "Sagar Pal" links to sagar-pal.dev and the star links to the GitHub repository, both in a new tab. The second row holds the EN | FR switch, an outline button "Copy link to this view" and two icon buttons: Print (it also saves a PDF) and Dark mode. On a phone, the switch sits next to one "More" menu, which holds "Share this view", "Print or save as PDF" and the theme, and the author line sits below them in a shorter form, "by Sagar Pal · ★ Star". In print, the switch and the buttons are hidden and the author line stays. A 2 px rule in the text colour runs underneath.
2. **Intro.** The headline "What homes in Paris and its suburbs have sold for since {month}, and where prices moved", with one sentence about the source. From 768 px wide, a second sentence says that every figure follows the Visitor's choice. The intro scrolls away. It has no figures of its own.
3. **Selection bar.** It is pinned to the top of the screen at every width (section 3). A thin progress line under it shows that a change is loading.
4. **The selected Area and its key figures.** A breadcrumb shows where the Area sits, for example "All Paris / 6e arrondissement / Odéon" for a Quartier, or the Department of a Commune. Each level above the Area is a link that selects it. The Area's name is a 30–36 px heading, with a line such as "All homes, 2024: 1 234 sales." A "Back to All Paris" button appears when an Area is selected. The key figures follow (section 4).
5. **Compare areas.** The map and the areas card, side by side on a wide screen. On a phone they are two tabs, Map and List.
6. **Price trend**, full width.
7. **What sold, and for how much.** The two histograms and the rooms table.
8. **Sales list**, a table of individual Sales. On a phone, one card per Sale.
9. **Footer.** "About the data" (it starts with "The figures describe past Sales. They are not a valuation of any home."), the inclusion rules and the excluded count, how the Change is measured, and the sources.

A "Skip to the figures" link is the first thing a keyboard reaches. It jumps to the selected Area.

## 3. How a Visitor changes the Selection

Every panel answers to the Selection. On a laptop or tablet the Selection bar holds, from left to right:

- **Area**, a field button that shows the selected Area. It opens a popover with the Area picker:
  - with an empty search box: tiles for All Paris, the 20 Arrondissements and the 3 Departments
  - with text typed: a grouped list of Departments, Quartiers by Arrondissement, Communes by Department, and Major towns

  A choice closes the popover.
- **Property type**, a three-option segmented control: All, Apartments and Houses.
- **Period**, a field button that shows the dates. It opens a popover with the Period picker:
  - presets as pills: "All dates", one per calendar year, and "Last 12 months"
  - a small chart of the whole timeline, with Sales counts as bars and the median as a line, under a range brush with two handles and year ticks below. A drag changes the Period only when the handle is released.
  - "From" and "To" month menus, so the dates can be set without dragging
- **A status line** on the right: "12 054 sales in this Selection", or "Updating" with a spinner during a change.

On a phone the bar is one summary button. It shows the Area on one line, the property type and the Period on a second line, and a "Change" label. It opens a sheet from the bottom of the screen that holds the same Area picker, property type and Period picker. The page behind the sheet updates as the Visitor chooses, and "Done" closes the sheet.

An Area can also be chosen outside the bar:
- a click on an area of the map, or on a dot of the dot map
- a click on a row of the ranking, or on a row name of the heat map, or "Focus the page on …" under the heat map readout
- a click on an Area or Quartier link in the Sales list
- a link in the breadcrumb, or "Back to All Paris"

Four behaviours shape the feel of the page:
- **The controls answer at once, and the panels change all together.** When a Visitor clicks, the control changes immediately and the status line says "Updating". The panels keep the old Selection, correctly named, until all the new data has arrived. Then the whole page changes in one redraw. One Area's figures never appear under another Area's name, and a panel never goes blank during a change. Each Selection change costs at most 200 ms of work on a mid-range machine, and the target is measured.
- **The URL holds the Selection.** A link or a bookmark reproduces the view. When a link's dates fall outside the latest data, a short notice under the Selection bar says that the Period moved.
- **Back and Forward move between Areas.** A new Area adds a browser history entry. Every other change, such as the dates, the property type or a panel setting, replaces the current entry. So one press of Back returns to the previous Area, with the settings it had.
- **Some settings belong to one panel.** The map mode, the trend's granularity and Smoothing, the areas card's tab and group, and the Sales list's sort and page change only their own panel.

## 4. Panels

Each panel sits on a flat card: 12 px corners, a 1 px border, and no shadow. The card header holds a serif title (18–19 px), a short description, the panel's own controls on the right, and a small CSV download button. Most panels also start with a one-sentence takeaway, for example "In all of Paris, the median was 9 800 EUR/m² in the last 12 months of the Period, against 10 829 in the first 12: -9.5%."

**Key figures**
- **The lead card** is the median price per m², in a large serif figure in the bordeaux primary colour, with its Change chip (▲ rise or ▼ fall) and the start and end figures. Its tooltip explains how the Change is measured.
- **Beside an Area,** the lead card adds "All Paris: 12 212 EUR/m², +4.6%" for the same property type and Period.
- **Four smaller cards:** Sales recorded (with the total value, "Worth 84.55 Md EUR in total"), Median price, Median surface ("Built surface") and Price range.
- **House share:** a note appears once, and only from 1% of houses, because a house's price includes its land.

**Map**
- **Three modes:** "Price level", a choropleth of the median price per m²; "Price change", a choropleth of the Change; and "Sales", one dot per rounded position.
- **Detail:** in the first two modes, the Visitor can show Arrondissements or Quartiers. The Communes around Paris always appear.
- **Arrondissement numbers** are written on the map wherever a shape is wide enough to hold one, so more appear as the Visitor zooms in.
- **Scrolling:** a plain mouse wheel scrolls the page, not the map, and a hint says "Hold ⌘ (or Ctrl) and scroll to zoom the map". On a phone, one finger scrolls the page and two fingers move the map.
- **Base map:** Esri's light-grey or dark-grey tiles.
- **Area drawing:** the focused Area is drawn at full strength, and the others are faded. The selected Area has a thick dark outline.
- **Legend:** under the map, 9 colour steps with their thresholds for price, and a red-to-blue gradient for change. On a phone it becomes a list of colour ranges.
- **Tooltips:** each Area shows its name, median and number of Sales. A dot shows its Sale, or a short list of the Sales at that spot.
- **Dot map limit:** it shows at most the newest 5,000 Sales, with a notice when the limit applies. A dot's size grows with the number of Sales at that spot.
- **Time travel (Price level mode only):** a row under the map has a Play button, a slider through the quarters, a readout ("Whole range" or "4 quarters ending here"), and "Back to range average". Playback steps every 0.7 s.

**Areas card.** One card with two tabs, "Ranking" and "Quarter by quarter", and one Group menu: Paris, Hauts-de-Seine, Seine-Saint-Denis, Val-de-Marne or Major towns.
- **Ranking.** Rows are the Arrondissements of Paris, or the Communes of one Department or of the Major towns. It sorts "By price" or "By change". Each row has its rank, name, the value in its own column, a horizontal bar in the price colour (with a dotted line for the middle half of Sales), the number of Sales, a Change chip and a small quarterly sparkline. The house-share column shows only when the share says something; in Paris it is about 0% everywhere. A click selects the Area. When an Area is selected, the other rows fade. On a phone the list does not scroll inside its box.
- **Quarter by quarter (heat map).** One row per Area of the group, one column per quarter. A cell's colour is the price level, or the Change since the first quarter. It fits a 375 px screen without sideways scrolling. Hovering, focusing or tapping a cell shows its figures in a readout above the grid, with ◀ ▶ buttons to step through the quarters. A cell does not select its Area: the row name and the "Focus the page on …" button do that. A click on a year mark sends that quarter to the map. Cells with fewer than 10 Sales have a dashed outline. "Colour by" switches between Price level and Change.

**Price trend**
- **Lines:** a chart of the median price per m² over time. Each line's name is written at its end, so there is no legend. An optional band shows the middle half of Sales (P25–P75). A dashed line shows all of Paris for comparison when an Area is selected. Points with fewer than 10 Sales are drawn as hollow circles.
- **Count strip:** a strip below the chart counts Sales per period.
- **Controls:** granularity (Month, Quarter, Year), a Smoothing switch and a P25–P75 switch.

**Distributions.** The first histogram shows sale prices, and the second shows price per m². Each has a takeaway sentence such as "Half of the sales were between 265 k EUR and 690 k EUR." Bars in the middle half of Sales are darker. Reference lines mark P25, the median and P75. A strip of P10 to P90 values sits underneath.

**By number of rooms.** A table with one row for each of 1 to 5+ rooms: the number of Sales, the median price with a bar, and the median price per m².

**Sales list**
- **Columns:** Date, Street, Area, Quartier, Type, Rooms, Surface, Price and Price / m². The Area column is hidden when the Selection is a single Area.
- **Sorting:** the Visitor can sort by Date, Surface, Price or Price / m². The active column shows an arrow and reports its sort order to screen readers.
- **Cells:**
  - The Area cell has a small square in the Area's price colour, and a click selects that Area.
  - The Quartier is a link that selects it.
  - The Type is a pill.
  - The Price / m² has a small square in the price colour.
- **On a phone:** one card per Sale, with a sort menu.
- **Pages:** 15 rows per page, with "1–15 of n" and previous and next buttons.
- **What a Sale shows:** only its street and a position rounded to about 100 m, never a house number. The list's description says so.

## 5. Visual system

**Typography**
- **Fraunces (serif, 600 and 700)** is used for the title, headings, card titles and the large figures.
- **IBM Plex Sans** is used for the interface text.
- **IBM Plex Mono**, with tabular figures, is used for numbers in tables and labels.
- **Sizes, laptop / phone:**
  - headline: 40 / 26 px
  - Area heading: 36 / 30 px
  - section heading: 26 / 22 px
  - card title: 19 / 18 px
  - body: 16 px
  - labels: 14 px
  - captions: 12 px, the smallest size anywhere

**Colour.** The look is warm paper and ink with a bordeaux accent. Dark mode uses a deep navy background.

| Role | Light | Dark |
| --- | --- | --- |
| Background | `#f6f3ee` | `#0e121b` |
| Card | `#fcfbf8` | `#141824` |
| Sunken (segmented track, hover) | `#efebe4` | `#1b2030` |
| Text | `#151e32` | `#f1ece4` |
| Muted text | `#5e6678` (5.2:1) | `#9299aa` (6.2:1) |
| Border, for cards and dividers only | `#ded7cf` | `#252a37` |
| Control border (inputs and fields, 3.6:1) | `#8b8378` | `#727a8e` |
| Primary (bordeaux) | `#952336` | `#e25a71` |
| Navy: comparison line and focus ring | `#1f3a68` | `#8fb0e6` |
| Fall chip (background / text) | `#e3ebf7` / `#1f3f75` | `#1a2638` / `#b9d0f5` |
| Rise chip (background / text) | `#f8e1e1` / `#8e1b2b` | `#3a1c22` / `#f2a3ad` |

- **The price scale** has 9 steps of the Magma palette, from pale yellow (#fddea0, the cheapest) to deep purple (#251255, the most expensive). The thresholds are quantiles, so each step holds a similar share of the Areas. One scale is shared by the map, the ranking, the heat map, the dots and the colour marks in the Sales list. Paris and the Communes weigh equally in the thresholds.
- **The Change scale** is diverging: red for rises, blue for falls, and pale in the middle.

**Shape and depth**
- **Radii:** 12 px for cards and sheets, 8 px for controls and tooltips, 4 px for chips.
- **Elevation:** cards are flat. Only tooltips and popovers, and the phone sheet, have shadows.
- **Tooltips:** the map and the charts share one tooltip style.

**Controls**
- **Three button kinds:** outline buttons for secondary actions, icon buttons, and a filled primary button.
- **Segmented controls** for small sets of choices. The same control also serves as tabs.
- **Field buttons** in the Selection bar, with an icon, a label and the current value.
- **One switch style** for on and off settings.
- **Heights:** 40 px with a mouse, 44 px on touch screens. Inputs use 16 px text on touch screens, so iOS does not zoom on focus.

**Motion**
- Popovers and the phone sheet open with a short fade and slide. The Area popover closes without an animation, because the close would otherwise add work to the Selection change.
- The "Updating" status and the progress line appear during a change.
- Map shapes fade as their colour changes.
- The map flies to a new Area in 0.8 s.
- Cards do not animate on load.
- With reduced motion turned on, all of these animations are off.

**Dark mode** follows the system setting. The toggle switches to the other theme and remembers the choice on this device. A toggle back to the system's own theme makes the page follow the system again. A small script in `index.html` applies the theme before the first paint, so a dark page does not flash light. When the browser blocks site data, the toggle still works for the visit.

**Print.** The Print button prints the page, or saves it as a PDF. Printing always uses the light palette, also in dark mode. It hides all the controls, keeps each card on one page, and shows the full content of the boxes that scroll.

## 6. States

- **First load:** a centred line, "Loading the sales data...", or an error with "Try again".
- **Loading a panel:** a pale bordeaux skeleton in the shape of the panel. During a Selection change, the panels keep their old content instead of showing skeletons.
- **A panel that fails:** "This data did not load. Check your connection and try again.", with a "Try again" button. The other panels carry on.
- **Too few Sales:** a median based on fewer than 5 Sales is not shown, and "Too few sales" appears in its place. Other empty states say what to try, for example "Try a longer period or a larger area."

## 7. Responsive behaviour

- **Phones (below 768 px):** the Selection bar is one button that opens a sheet. The masthead's actions are in one "More" menu. The map and the areas card are two tabs. The Sales list shows one card per Sale. The heat map fits the screen. There is no sideways scroll at 375 px. On touch screens, controls are at least 44 px.
- **Tablets and laptops (768–1279 px):** the Selection bar shows the Area and Period fields, the property type and the status line, and the map and the areas card are stacked.
- **Large screens:** the map and the areas card sit side by side.

## 8. Accessibility

- **Keyboard order:** the first Tab reaches "Skip to the figures", then the masthead, then the Selection bar.
- **Buttons:** every toggle and segmented button reports whether it is pressed, and tabs report which one is selected. Icon buttons have labels. A navy focus ring appears for keyboard users.
- **Popovers and the sheet:** Esc closes them.
- **Period:** the brush works with the arrow keys and keeps its focus. The From and To month menus set the dates without dragging (WCAG 2.5.7). The quarter slider is a standard range input.
- **Heat map:** Tab moves into the cells, and focus shows a cell's figures in the readout.
- **Sales list:** sortable columns report their sort order.
- **Zoom:** pinch zoom is allowed (WCAG 1.4.4).
- **Not keyboard reachable:** the map's areas and dots, which are drawn on a canvas. The ranking and the Area picker reach the same Areas.
- **Colour:** several encodings rely on colour alone: the choropleth, the dots, the heat map cells, and the colour marks in the Sales list. The Change chip adds an arrow and a sign.

## 9. Words and units

- The tone is plain and explanatory, with full sentences.
- Prices are nominal euros, written "EUR" and "EUR/m²". Large values use "k EUR", "M EUR" and "Md EUR" (billions). The symbol € is not used.
- Numbers use French grouping, as in "12 345", in both languages. Decimals follow the language: "+3.4%" and "1.2 M EUR" in English, "+3,4 %" and "1,2 M EUR" in French, with a narrow no-break space before "%". A negative number has a minus sign (−), not a hyphen. A Change has a sign and one decimal place.
- Ranges use an en dash: "Jul 2021 – Jun 2026", "2021, Jul–Dec".
- French text has a no-break space before ":" and a narrow no-break space before ";", "?", "!" and "%".
- A year that the data covers only in part always shows its months, for example "2021, Jul–Dec".

## 10. Analytics

The site counts the use of each control with Umami: Area choices and the control used to make them, Period changes, map modes, sorts, exports and so on. If a redesign adds, removes or merges a control, its analytics event must be updated as well. The events never record anything about a single Sale.

## 11. Known rough spots

These are observations, not decisions. The redesign fixed the earlier list: the tall bar of Selection controls, the duplicated group switch, the many button and switch styles, the two tooltip styles, the very small text, the transparent shadows, the copy issues, dark mode, the crash screen, the two-axis rooms chart, the data reload control in the masthead and the unused Inter font.

1. **The fonts come from Google Fonts.** Self-hosting them is on the launch list (issue #1), and it is planned as its own change.
2. **A year preset now takes two clicks on a laptop**, because the Period is behind a button. In exchange, the sticky bar is about 72 px tall instead of about 120 px. Watch the `change-period` counts after launch.
3. **The Area search results** do not show each Area's median and colour. Doing that would add a Quartier stats request every time the picker opens.
4. **The distributions on a phone** are stacked, not tabbed.
5. **The map's areas and dots** are not reachable with a keyboard (section 8).
6. **There are no component tests** for the Selection bar and the Area picker. The `node:test` setup covers `lib/` only, so these would need a DOM test runner, which is a separate decision.

## 12. What a redesign must keep

- **No Valuation.** Nothing may suggest a fair price or an estimate for one home.
- **The Sale location rule.** A Sale shows its street and a position rounded to about 100 m, never a house number.
- **The figures and their rules:**
  - a median, count, total or minimum/maximum is shown only with at least 5 Sales
  - a point with fewer than 10 Sales is marked
  - the 9-step quantile price scale, shared by every panel
- **The dot map's form.** It stays as dots, with no clusters or squares. It stays on the current map library and not on WebGL.
- **The speed target and the change model.** Each Selection change takes at most 200 ms of work. The page changes in one redraw when the data is in, and keeps the old Selection, correctly named, until then. The map's fly-to is outside the 200 ms.
- **The Selection in the URL**, so that links reproduce a view.
- **The vocabulary** from section 1, in English and in French.

## Appendix: where things live in the code

All paths are under `artifacts/data-app/`.

- **Page layout and section order:** `src/pages/dashboard.tsx`.
- **Styles and colour tokens:** `src/index.css`. The theme script that runs before the first paint is in `index.html`.
- **Theme:** `src/hooks/use-theme.ts`.
- **Selection bar, with its popovers and the phone sheet:** `src/components/selection-bar.tsx`.
- **Pickers:** `src/components/area-picker.tsx` and `src/components/time-control.tsx`. Each is used both in a laptop popover and in the phone sheet.
- **History rule (which changes add a Back step):** `src/lib/view-state.ts`.
- **Price scale:** `src/lib/colour-scale.ts`.
- **Number formats:** `src/lib/fmt.ts`.
- **Panels:**
  - key figures: `src/components/kpis.tsx`
  - map: `src/components/map-panel.tsx` and `sales-map.tsx`
  - areas card: `src/components/areas-card.tsx`, which holds `ranking.tsx` and `heatmap.tsx`
  - other panels: `src/components/hero-trend.tsx`, `distributions.tsx` and `transactions.tsx`
- **Shared controls, cards, legends and states:** `src/components/ui-bits.tsx`.
- **Analytics events:** `src/lib/analytics.ts`.
