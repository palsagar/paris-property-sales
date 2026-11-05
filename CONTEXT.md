# Paris Property Sales

A public website that helps home buyers and residents understand what homes in Paris have sold for and how prices have moved. Its figures come from DVF, the French tax administration's open data on property sales.

## Language

### Source data

**DVF**:
Demandes de valeurs foncières, the open dataset of property sales published by the DGFiP.
_Avoid_: Land registry, cadastre

**DVF release**:
One publication of DVF by the DGFiP. A release covers about the last five years, and the site never shows a period that the latest release has dropped.
_Avoid_: Delivery, version, data drop

**Mutation**:
One record of a change of ownership in DVF, which can cover several properties. A Mutation is raw source data and is not necessarily a Sale.
_Avoid_: Transaction, deed

**Sale**:
A Mutation that passes the inclusion rules: a "Vente" with exactly one apartment or house and no commercial premises, within the accepted price, surface and price per m² limits. Every figure on the site describes Sales.
_Avoid_: Transaction, listing

**Excluded mutation**:
A residential Mutation that fails the inclusion rules. The count of Excluded mutations covers the whole dataset and never a Selection.
_Avoid_: Outlier, filtered sale

**Sale location**:
What a Visitor can learn about where a Sale took place: the street name and a position rounded to about 100 m. It never includes the house number.
_Avoid_: Address, exact location

### Measures

**Built surface**:
The built floor area that DVF records for a property, in m². It is not the Carrez area.
_Avoid_: Surface (when the meaning could be unclear), Carrez, living area

**Price per m²**:
The price of a Sale divided by its Built surface, in nominal euros.
_Avoid_: Unit price, value per m²

**Change**:
The percentage difference between the median Price per m² in the first and last Change windows of a Period. It is blank when either Change window has fewer than 5 Sales.
_Avoid_: Growth, trend, appreciation

**Valuation**:
An estimate of what a specific home is worth. The site describes past Sales and never gives a Valuation.
_Avoid_: Fair price, estimate, price check

**Change window**:
One of the two stretches of a Period that a Change compares. Each covers half of the Period, up to 12 months.
_Avoid_: Window

**Smoothing window**:
The number of consecutive time buckets pooled into one point on a trend line.
_Avoid_: Window, rolling average

### Selecting what to look at

**Area**:
All of Paris, one arrondissement or one quartier.
_Avoid_: Scope, zone, district, neighbourhood

**Arrondissement**:
One of the 20 administrative divisions of Paris. An Arrondissement contains 4 quartiers.
_Avoid_: District

**Quartier**:
One of the 80 administrative subdivisions of Paris. A Quartier belongs to exactly one Arrondissement.
_Avoid_: Neighbourhood

**Period**:
The dates a Visitor has chosen. It defaults to the full coverage of the data.
_Avoid_: Range, time span, slice

**Selection**:
A property type, an Area and a Period, taken together. Every panel on the site describes the Sales in the current Selection.
_Avoid_: Scope, filters, slice, view

### People

**Visitor**:
A home buyer or Paris resident using the public site.
_Avoid_: User, customer

## Relationships

- A **Mutation** becomes either one **Sale**, an **Excluded mutation**, or neither (for example, a Mutation with no dwelling in it).
- A **Sale** has exactly one **Price per m²**, calculated from its **Built surface**.
- A **Selection** contains exactly one **Area** and one **Period**.
- A **Change** is calculated from two **Change windows** inside one **Period**.

## Example dialogue

> **Dev:** "The 6th arrondissement shows 3,365 Sales. Why does the data note still say 28,407 were left out?"

> **Domain expert:** "Because that number counts Excluded mutations across the whole dataset. We do not know how many belong to one Selection."

> **Dev:** "If someone buys two flats in one deed, is that a Sale?"

> **Domain expert:** "No. It is a Mutation with two dwellings, so it is an Excluded mutation. We cannot split its one price between the two flats."

> **Dev:** "A Visitor picks only the first half of 2026. What does the Change compare?"

> **Domain expert:** "Each Change window covers three months, so it compares January to March with April to June. Seasonal effects can show up in a Change that short."

> **Dev:** "A Visitor asks whether 12,000 EUR/m² is fair for a flat on a street they found. Can the site answer?"

> **Domain expert:** "No. That would be a Valuation. The site can show the Sales in that Quartier, and each Sale location, but the judgement stays with the Visitor."

## Flagged ambiguities

- **"Transaction"** was used for both Mutation and Sale. Use Sale for records on the site, and Mutation for raw records.
- **"Window"** was used for both Change window and Smoothing window. Always use the full term.
- **"Carrez or built surface"** appeared on the site, but the figures use only Built surface.
- **"Every recorded sale"** appeared on the site, but Excluded mutations are left out.
