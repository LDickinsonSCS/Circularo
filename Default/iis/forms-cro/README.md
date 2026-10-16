# /TotalAgility/forms/cro – friendly address for the CRO sign-in page

Sign out (CRO_UI_JS) sends users to `https://portal.sudocodesolutions.com/totalagility/forms/cro`.
TotalAgility does not serve that address itself, so it is a small folder in the TotalAgility web application that forwards to `CRO_Login.form`.

1. On the TotalAgility web server, find the physical folder behind `/TotalAgility/Forms` (IIS Manager → site → TotalAgility → Forms → Explore; typically `C:\Program Files\Tungsten\TotalAgility\Agility.Server.Web\Forms`).
2. Create a sub-folder `cro` and copy `index.html` into it.
3. Browse to `https://portal.sudocodesolutions.com/totalagility/forms/cro` – it should open the CRO sign-in page.

`index.html` is the default document (no IIS modules needed). Re-copy it after a TotalAgility upgrade if the Forms folder is replaced.
