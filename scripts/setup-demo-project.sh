#!/usr/bin/env bash
#
# The browser-only demo (any build without Firebase values) needs
# none of this; use this script only for a shared online demo.
#
# Creates a hosted FleetDesk demo you can share with prospective
# operators: a new Firebase project on the free Spark plan, with
# email sign-in, Firestore and its rules, the app on Firebase
# Hosting, and the fictional demo data from `pnpm demo:seed`.
#
# Needs: the Google Cloud CLI (gcloud), Node 22+, pnpm, and a
# Google account. Run from the repository root:
#
#   bash scripts/setup-demo-project.sh [project-id]
#
# Without a project id one is generated (fleetdesk-demo-xxxxxx).
# It only ever creates a new project, so it cannot touch an
# operator's live data.
set -euo pipefail

PROJECT="${1:-fleetdesk-demo-$(head -c3 /dev/urandom | od -An -tx1 | tr -d ' \n')}"
LOCATION="${DEMO_FIRESTORE_LOCATION:-nam5}"
FIREBASE="pnpm exec firebase"

step() { printf '\n==> %s\n' "$*"; }
token() { gcloud auth print-access-token; }
api() {
  # api METHOD URL [JSON]
  curl -sS --fail-with-body -X "$1" "$2" \
    -H "Authorization: Bearer $(token)" \
    -H "x-goog-user-project: $PROJECT" \
    -H "Content-Type: application/json" \
    ${3:+-d "$3"}
}

command -v gcloud >/dev/null || { echo "Install the Google Cloud CLI first: https://cloud.google.com/sdk/docs/install"; exit 1; }
[ -f package.json ] && grep -q '"demo:seed"' package.json || { echo "Run this from the repository root."; exit 1; }

step "Installing dependencies"
pnpm install --frozen-lockfile

step "Signing in to Google (a browser window opens twice)"
gcloud auth list --filter=status:ACTIVE --format='value(account)' | grep -q . || gcloud auth login
$FIREBASE login:list 2>/dev/null | grep -q '@' || $FIREBASE login
gcloud auth application-default print-access-token >/dev/null 2>&1 || gcloud auth application-default login

step "Creating project $PROJECT"
gcloud projects create "$PROJECT" --name="FleetDesk Demo"
gcloud services enable --project "$PROJECT" \
  firebase.googleapis.com firestore.googleapis.com identitytoolkit.googleapis.com \
  firebasehosting.googleapis.com firebaserules.googleapis.com
gcloud auth application-default set-quota-project "$PROJECT"

step "Adding Firebase"
$FIREBASE projects:addfirebase "$PROJECT"

step "Creating the Firestore database ($LOCATION)"
gcloud firestore databases create --project "$PROJECT" --location="$LOCATION" --type=firestore-native

step "Registering the web app"
APP_ID=$($FIREBASE apps:create WEB "FleetDesk Demo" --project "$PROJECT" --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).result.appId))')
CONFIG=$($FIREBASE apps:sdkconfig WEB "$APP_ID" --project "$PROJECT" --json)
cfg() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s).result;console.log((r.sdkConfig||r)[process.argv[1]])})' "$1" <<<"$CONFIG"; }
export NEXT_PUBLIC_FIREBASE_API_KEY="$(cfg apiKey)"
export NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="$(cfg authDomain)"
export NEXT_PUBLIC_FIREBASE_PROJECT_ID="$PROJECT"
export NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID="$(cfg messagingSenderId)"
export NEXT_PUBLIC_FIREBASE_APP_ID="$(cfg appId)"
export NEXT_PUBLIC_USE_FIREBASE_EMULATORS=false
export NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME="${NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME:-}"
export NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET="${NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET:-}"

step "Turning on email and password sign-in"
if ! api PATCH "https://identitytoolkit.googleapis.com/admin/v2/projects/$PROJECT/config?updateMask=signIn.email.enabled,signIn.email.passwordRequired" \
  '{"signIn":{"email":{"enabled":true,"passwordRequired":true}}}' >/dev/null; then
  echo
  echo "Firebase did not accept the setting from here. Turn it on by hand:"
  echo "  https://console.firebase.google.com/project/$PROJECT/authentication/providers"
  echo "  Get started -> Email/Password -> Enable -> Save"
  read -r -p "Press Enter once it is enabled... " _
fi

step "Building the app"
pnpm build

step "Deploying Hosting and the Firestore rules"
$FIREBASE deploy --project "$PROJECT" --only hosting,firestore:rules,firestore:indexes --non-interactive

step "Loading the demo data"
pnpm demo:seed -- --remote "--confirm=$PROJECT"

cat <<EOF

FleetDesk demo is live:  https://$PROJECT.web.app

Sign in with demo.admin@gmail.com / Demo@1234
(also demo.manager@, demo.frontdesk@, demo.fleet@, demo.accounts@,
demo.hr@ and demo.newhire@gmail.com, same password)

Anyone with the link can sign in with these accounts and change the
data, so share it only with people you are presenting to. Photo
uploads need a Cloudinary account (NEXT_PUBLIC_CLOUDINARY_* when
running this script); everything else works without one.
EOF
