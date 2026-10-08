# Question for Finexer support: dark mode on /connect/open

To: support@finexer.com
Subject: Can the "Please wait..." page at /connect/open honour our dark template?

Hello,

We use Finexer app templates to style the hosted consent pages for our app, Sorted (AURIQ LTD). Our dark template works on the consent page, but users in dark mode first see a bright white "Please wait..." page at https://finexer.com/connect/open before the consent page loads. It is a visible flash on every connection.

Our identifiers:

- App id: acc_DqPCRpHskkjNy7uYa1wv7mSv
- Light template: Sorted light, aYiuDETVBXPq
- Dark template: Sorted dark, 8pq22L45Lf9L

Your White-labeling documentation says template CSS restyles the hosted consent and authorisation pages, using classes such as .consent-content, .block-content, .container-desktop, .consent-left-bar and .consent-right-bar. It does not say whether the /connect/open interstitial is covered, and the dashboard's Consent journey options have no setting for it.

Our questions:

1. Does the app template's CSS (or any template setting) apply to /connect/open? If so, which selectors should we target for the page body and the spinner?
2. If not, can that page honour the prefers-color-scheme media query, or use a background colour taken from the template?
3. If neither is possible today, is there a supported way to skip the interstitial or shorten it?

We have already added a conservative rule to our dark template (html and body background #0f172a, color-scheme dark), which we will sync only if you confirm the template reaches that page. We change colours only and never alter the permission list or regulated footer.

Thank you,
Kevin Maingi
AURIQ LTD
