# D’AUBE SONNTAG — First Light Follow Drop

Public campaign: https://work.daubesonntag.com/campaigns/first-light/

## Campaign window
- Opens: 2026-09-07
- Closes: 2026-09-10 23:59 Asia/Ho_Chi_Minh
- No purchase required.
- TikTok does not sponsor or administer the campaign.

## Entry rule
A qualified entry must be verified from available provider evidence against the published campaign requirements:
1. Follow `@daube.sonntag`.
2. Like the campaign post.
3. Comment `FIRST LIGHT` plus one emoji before close.

If a required criterion cannot be verified from provider evidence, eligibility is `UNKNOWN`, not assumed true.

## Prize allocation
### First Light Mini Pack
The first 30 verified qualified entries are selected chronologically from the provider-backed eligible pool.

### Sunday Surprise Pack
Three unique verified eligible participants are selected by a reproducible deterministic draw after campaign close.

### Golden Follower Gift
One additional unique verified eligible participant is selected by the same reproducible draw method after removing prior bonus recipients.

## Reproducible draw method
1. Normalize each verified eligible public handle to lowercase Unicode NFC.
2. Sort the verified eligible pool lexicographically for the random-draw stage.
3. Record the ordered-pool SHA-256 digest.
4. Build the draw seed from:
   `FIRST_LIGHT_2026-09-10T23:59:00+07:00|<ordered-pool-sha256>`
5. Hash the seed with SHA-256.
6. For draw index `i`, compute `SHA256(seed_hash + "|" + i + "|" + handle)` for each remaining handle and select the lexicographically smallest resulting digest.
7. Remove the selected handle from the remaining bonus pool and continue until 3 Sunday Surprise + 1 Golden recipient are selected.

This method makes the draw repeatable once the verified pool is frozen while preventing D’AUBE from silently changing a winner after the fact without changing the published pool digest.

## Winner truth boundary
Do not publish or message a winner until their entry is actually verified. Do not infer missing followers, likes, comments, names, or timestamps. Public announcement should use only the minimum public-safe display information required.

## Personalized winner links
Format:
`https://work.daubesonntag.com/campaigns/first-light/?name=<URL-encoded-display-name>`

The personalization parameter changes presentation only; it is not an authentication or access-control mechanism.

## Delivery sequence
`verify → freeze eligible pool → record digest → select → personalize → announce → deliver → record status`

## Campaign assets
The public campaign page references D’AUBE-owned campaign visuals already staged through the connected social publishing system. The campaign page is intentionally static and zero-spend.