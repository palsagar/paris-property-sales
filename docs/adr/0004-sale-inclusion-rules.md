# A Sale has exactly one dwelling and passes fixed limits

A Mutation counts as a Sale only if all of these conditions are true:

- Its nature is "Vente".
- It has no commercial premises.
- It has exactly one apartment or house.
- Its price is 20,000 to 20,000,000 EUR.
- Its Built surface is 9 to 300 m².
- Its Price per m² is 2,000 to 35,000 EUR.

DVF records one price for a whole Mutation, so a price cannot be split reliably between several properties. The limits remove records that would distort the medians. In the current data, 128,114 Mutations pass, and 28,407 residential Mutations are Excluded mutations.

The original project recorded no reasons for these rules, except the note that exclusions keep the Price per m² reliable. The rest of this reasoning is inferred from the code.

Every figure on the site depends on these rules, so a change to them changes the whole site. Price per m² uses Built surface and not the Carrez area, because Built surface gives one definition for both apartments and houses.

## Consequences

- The site does not show every recorded sale, and its text must not claim to.
- A change to the rules must also update the exclusion total in `salesData.ts`, the data note and the README.
