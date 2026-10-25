"""The Finexer agency disclosure, for Penny's connect-a-bank proposal card (B60).

FIXED TEXT required verbatim by Finexer (Client Terms Part C clause A4.1). Copied
from frontend/lib/regulatoryCopy.ts, the single source for the app. Do not
reword: the Node gate check:b60-regulatory-parity compares the two files
character for character. The trading-name sentence is shown immediately before
the agent sentence, in the same paragraph (A163).
"""

AGENT_DISCLOSURE = "AURIQ LTD is acting as an agent of Finexer LTD, which is authorised by the Financial Conduct Authority under the Payment Services Regulations 2017, firm reference number 925695, as an Authorised Payment Institution to provide account information services and payment initiation services."

TRADING_NAME_DISCLOSURE = "Sorted is a trading name of AURIQ LTD."
