"use client";

const COUNTRY_CODES = [
  "AD","AE","AF","AG","AI","AL","AM","AO","AQ","AR","AS","AT","AU","AW","AX",
  "AZ","BA","BB","BD","BE","BF","BG","BH","BI","BJ","BL","BM","BN","BO","BQ",
  "BR","BS","BT","BV","BW","BY","BZ","CA","CC","CD","CF","CG","CH","CI","CK",
  "CL","CM","CN","CO","CR","CU","CV","CW","CX","CY","CZ","DE","DJ","DK","DM",
  "DO","DZ","EC","EE","EG","EH","ER","ES","ET","FI","FJ","FK","FM","FO","FR",
  "GA","GB","GD","GE","GF","GG","GH","GI","GL","GM","GN","GP","GQ","GR","GS",
  "GT","GU","GW","GY","HK","HM","HN","HR","HT","HU","ID","IE","IL","IM","IN",
  "IO","IQ","IR","IS","IT","JE","JM","JO","JP","KE","KG","KH","KI","KM","KN",
  "KP","KR","KW","KY","KZ","LA","LB","LC","LI","LK","LR","LS","LT","LU","LV",
  "LY","MA","MC","MD","ME","MF","MG","MH","MK","ML","MM","MN","MO","MP","MQ",
  "MR","MS","MT","MU","MV","MW","MX","MY","MZ","NA","NC","NE","NF","NG","NI",
  "NL","NO","NP","NR","NU","NZ","OM","PA","PE","PF","PG","PH","PK","PL","PM",
  "PN","PR","PS","PT","PW","PY","QA","RE","RO","RS","RU","RW","SA","SB","SC",
  "SD","SE","SG","SH","SI","SJ","SK","SL","SM","SN","SO","SR","SS","ST","SV",
  "SX","SY","SZ","TC","TD","TF","TG","TH","TJ","TK","TL","TM","TN","TO","TR",
  "TT","TV","TW","TZ","UA","UG","UM","US","UY","UZ","VA","VC","VE","VG","VI",
  "VN","VU","WF","WS","YE","YT","ZA","ZM","ZW",
] as const;

type CountryCode =
  (typeof COUNTRY_CODES)[number];

function countryName(
  code: CountryCode,
): string {
  try {
    const displayNames =
      new Intl.DisplayNames(
        ["en"],
        {
          type: "region",
        },
      );

    return (
      displayNames.of(code) ??
      code
    );
  } catch {
    return code;
  }
}

/*
 * The picker works either way round: the booking and signup
 * forms read it by name after a submit, while the customer
 * editors hold the value in component state. Passing `value`
 * selects the controlled mode.
 */
export function CountrySelect({
  id,
  name,
  value,
  onChange,
  defaultValue = "",
  required = false,
  disabled = false,
}: {
  id?: string;
  name?: string;
  value?: string;
  onChange?: (
    event: React.ChangeEvent<HTMLSelectElement>,
  ) => void;
  defaultValue?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const countries =
    [...COUNTRY_CODES]
      .map((code) => ({
        code,
        name: countryName(code),
      }))
      .sort((a, b) =>
        a.name.localeCompare(
          b.name,
        ),
      );

  return (
    <select
      id={id}
      name={name}
      required={required}
      disabled={disabled}
      onChange={onChange}
      {...(value === undefined
        ? { defaultValue }
        : { value })}
    >
      <option value="">
        Select country
      </option>

      {countries.map(
        (country) => (
          <option
            key={country.code}
            value={country.code}
          >
            {country.name} (
            {country.code})
          </option>
        ),
      )}
    </select>
  );
}