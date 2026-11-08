# Paris & Suburbs Property Sales

A public website, in English and French, that helps home buyers and residents understand what homes in Paris and its suburbs have sold for and how prices have moved. Its figures come from DVF, the French tax administration's open data on property sales. Its French name is "Ventes immobilières à Paris et alentours".

## Language

### Source data

**DVF**:
Demandes de valeurs foncières, the open dataset of property sales published by the DGFiP.
_French_: DVF
_Avoid_: Land registry, cadastre

**DVF release**:
One publication of DVF by the DGFiP, in April or October. A release covers about the last five years and can correct any part of them. The site shows exactly the dates that the latest release covers.
_French_: Publication DVF
_Avoid_: Delivery, version, data drop

**Mutation**:
One record of a change of ownership in DVF, which can cover several properties. A Mutation is raw source data and is not necessarily a Sale.
_French_: Mutation
_Avoid_: Transaction, deed

**Sale**:
A Mutation that passes the inclusion rules: a "Vente" with exactly one apartment or house and no commercial premises, within the accepted price, surface and price per m² limits. Every figure on the site describes Sales.
_French_: Vente
_Avoid_: Transaction, listing

**Excluded mutation**:
A residential Mutation that fails the inclusion rules. The count of Excluded mutations covers the whole dataset and never a Selection.
_French_: Mutation exclue
_Avoid_: Outlier, filtered sale

**Sale location**:
What a Visitor can learn about where a Sale took place: the street name and a position rounded to about 100 m. It never includes the house number.
_French_: Localisation de la vente
_Avoid_: Address, exact location

### Measures

**Built surface**:
The built floor area that DVF records for a property, in m². It is not the Carrez area.
_French_: Surface bâtie
_Avoid_: Surface (when the meaning could be unclear), Carrez, living area

**Price per m²**:
The price of a Sale divided by its Built surface, in nominal euros.
_French_: Prix au m²
_Avoid_: Unit price, value per m²

**Change**:
The percentage difference between the median Price per m² in the first and last Change windows of a Period. It is blank when either Change window has fewer than 5 Sales.
_French_: Évolution
_Avoid_: Growth, trend, appreciation

**House share**:
The percentage of the Sales in a Selection that are houses. A house's price includes its land, but its Price per m² uses only its Built surface, so a high House share raises a median and makes it harder to compare with an area of apartments.
_French_: Part de maisons
_Avoid_: Mix

**Valuation**:
An estimate of what a specific home is worth. The site describes past Sales and never gives a Valuation.
_French_: Estimation
_Avoid_: Fair price, estimate, price check

**Change window**:
One of the two stretches of a Period that a Change compares. Each covers half of the Period, up to 12 months.
_French_: Fenêtre de comparaison
_Avoid_: Window

**Smoothing window**:
The number of consecutive time buckets pooled into one point on a trend line.
_French_: Fenêtre de lissage
_Avoid_: Window, rolling average

### Selecting what to look at

**Area**:
All of Paris, one Department, one Arrondissement, one Quartier or one Commune. There is no Area for the whole region, because its figures would depend on which Communes the site includes.
_French_: Secteur
_Avoid_: Scope, zone, district, neighbourhood

**Arrondissement**:
One of the 20 administrative divisions of Paris. An Arrondissement contains 4 quartiers.
_French_: Arrondissement
_Avoid_: District

**Quartier**:
One of the 80 administrative subdivisions of Paris. A Quartier belongs to exactly one Arrondissement.
_French_: Quartier
_Avoid_: Neighbourhood

**Commune**:
One French municipality outside Paris that the site includes. It is the smallest Area outside Paris.
_French_: Commune
_Avoid_: Banlieue, suburb (for one town), city

**Department**:
Hauts-de-Seine (92), Seine-Saint-Denis (93) or Val-de-Marne (94). The site includes every Commune in these three, so each one is a complete Area. Other departments are not Areas.
_French_: Département
_Avoid_: County, region

**Major town**:
A Commune outside the three Departments that the site includes: either it has at least 50,000 residents, or it is Saint-Germain-en-Laye, Fontainebleau or Melun. Major towns are listed together, but their combined figures are never shown.
_French_: Grande ville
_Avoid_: Outer ring, satellite town

**Period**:
The dates a Visitor has chosen. It defaults to all the dates in the latest DVF release.
_French_: Période
_Avoid_: Range, time span, slice

**Partial year**:
A calendar year that the latest DVF release covers only in part. The site always labels it with its months, for example "2021, Jul–Dec".
_French_: Année partielle
_Avoid_: Incomplete year

**Selection**:
A property type, an Area and a Period, taken together. Every panel on the site describes the Sales in the current Selection.
_French_: Sélection
_Avoid_: Scope, filters, slice, view

### People

**Visitor**:
A home buyer or resident of Paris or its suburbs using the public site.
_French_: Visiteur
_Avoid_: User, customer

## Relationships

- A **Mutation** becomes either one **Sale**, an **Excluded mutation**, or neither (for example, a Mutation with no dwelling in it).
- A **Sale** has exactly one **Price per m²**, calculated from its **Built surface**.
- A **Selection** contains exactly one **Area** and one **Period**.
- A **Change** is calculated from two **Change windows** inside one **Period**.
- A **Commune** belongs to one **Department** or is a **Major town**, never both.
- A **Quartier** belongs to one **Arrondissement**, and an **Arrondissement** belongs to Paris. A **Commune** has no smaller Area inside it.

## Example dialogue

> **Dev:** "The 6th arrondissement shows 3,365 Sales. Why does the data note still say 39,375 were left out?"

> **Domain expert:** "Because that number counts Excluded mutations across the whole dataset. We do not know how many belong to one Selection."

> **Dev:** "If someone buys two flats in one deed, is that a Sale?"

> **Domain expert:** "No. It is a Mutation with two dwellings, so it is an Excluded mutation. We cannot split its one price between the two flats."

> **Dev:** "A Visitor picks only the first half of 2026. What does the Change compare?"

> **Domain expert:** "Each Change window covers three months, so it compares January to March with April to June. Seasonal effects can show up in a Change that short."

> **Dev:** "A Visitor asks whether 12,000 EUR/m² is fair for a flat on a street they found. Can the site answer?"

> **Domain expert:** "No. That would be a Valuation. The site can show the Sales in that Quartier, and each Sale location, but the judgement stays with the Visitor."

> **Dev:** "Can a Visitor select Versailles and Meaux together and see one median?"

> **Domain expert:** "No. Each is a Major town, so each is its own Area. They appear in one list so that a Visitor can compare them, but the site never shows a figure for the list as a whole."

> **Dev:** "A saved link asks for July to December 2021, and the latest DVF release no longer covers those dates. What does the Visitor see?"

> **Domain expert:** "The nearest dates that the release does cover, with a short notice that says the Period changed."

## Flagged ambiguities

- **"Transaction"** was used for both Mutation and Sale. Use Sale for records on the site, and Mutation for raw records.
- **"Window"** was used for both Change window and Smoothing window. Always use the full term.
- **"Carrez or built surface"** appeared on the site, but the figures use only Built surface.
- **"Every recorded sale"** appeared on the site, but Excluded mutations are left out.
- **"Banlieue"** was used for the Communes around Paris. The word has a negative meaning in French for some places, so the site does not use it. Use Commune for one town, and "suburbs" only in general English text.
- **"Estimation"** means a Valuation in the French text, and the site never gives one. Do not use the word in French text for any other meaning, for example a rough figure.
- **"Zone"** is not the French term for Area, because it sounds administrative. Use Secteur.
