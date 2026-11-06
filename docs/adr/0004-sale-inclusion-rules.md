# A Sale has exactly one dwelling and passes fixed limits

A Mutation counts as a Sale only if all of these conditions are true:

- Its nature is "Vente".
- It has no commercial premises.
- It has exactly one apartment or house.
- Its price is 20,000 to 20,000,000 EUR.
- Its Built surface is 9 to 300 m².
- Its Price per m² is 1,000 to 35,000 EUR.

DVF records one price for a whole Mutation, so a price cannot be split reliably between several properties. The limits remove records that would distort the medians. On the October 2026 DVF release, 404,582 Mutations pass, and 66,954 are Excluded mutations.

The original project recorded no reasons for these rules, except the note that exclusions keep the Price per m² reliable. The rest of this reasoning is inferred from the code.

Every figure on the site depends on these rules, so a change to them changes the whole site. Price per m² uses Built surface and not the Carrez area, because Built surface gives one definition for both apartments and houses.

## The lowest Price per m² is 1,000 EUR

The lowest accepted Price per m² is 1,000 EUR, since the site covers the Communes around Paris. The earlier limit of 2,000 EUR suited Paris, where it removed 0.9% of Sales, but it removed far more elsewhere and raised the medians of the cheapest towns. On the October 2026 DVF release, the lower limit moves the median Price per m² in Sarcelles from 2,814 to 2,170 EUR (−22.9%) and in Évry-Courcouronnes from 2,600 to 2,368 EUR (−8.9%). The median for Paris moves from 10,215 to 10,200 EUR (−0.1%). With the old floor, 396,945 Sales pass in total and 144,217 in Paris.

We keep one limit for the whole site, because a limit per Area would make the figures harder to explain and to compare. We do not remove the limit, because Sales under 1,000 EUR/m² have a median price of about 58,600 EUR for 90 m², which does not look like normal market sales. We have not verified the reason for those low prices.

## Consequences

- The site does not show every recorded sale, and its text must not claim to.
- A change to the rules must also update the exclusion total in `salesData.ts`, the data note and the README.
