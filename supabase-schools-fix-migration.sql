-- Fixes the onboarding university-search dropdown: production `schools` table
-- is missing columns the query selects (status, login_url, token_flow, domain),
-- which makes every search silently fail (42703, swallowed by the client) and
-- the dropdown never shows results. Also seeds a starter set of universities
-- since the table was empty.

alter table public.schools add column if not exists status     text;
alter table public.schools add column if not exists login_url  text;
alter table public.schools add column if not exists token_flow text;
alter table public.schools add column if not exists domain     text;

-- Needed for the "on conflict do nothing" seed below (safe to rerun this file).
create unique index if not exists schools_name_unique on public.schools (name);

notify pgrst, 'reload schema';

-- Starter seed — common US universities, marked "needsVerification" since we
-- don't have confirmed Canvas login URLs / token flows for them yet. Safe
-- default: onboarding will ask the student to confirm/enter their Canvas URL.
insert into public.schools (name, city, country, continent, status) values
  ('Harvard University', 'Cambridge', 'United States', 'North America', 'needsVerification'),
  ('Stanford University', 'Stanford', 'United States', 'North America', 'needsVerification'),
  ('Massachusetts Institute of Technology', 'Cambridge', 'United States', 'North America', 'needsVerification'),
  ('University of California, Berkeley', 'Berkeley', 'United States', 'North America', 'needsVerification'),
  ('University of California, Los Angeles', 'Los Angeles', 'United States', 'North America', 'needsVerification'),
  ('University of Michigan', 'Ann Arbor', 'United States', 'North America', 'needsVerification'),
  ('University of Texas at Austin', 'Austin', 'United States', 'North America', 'needsVerification'),
  ('New York University', 'New York', 'United States', 'North America', 'needsVerification'),
  ('Columbia University', 'New York', 'United States', 'North America', 'needsVerification'),
  ('University of Pennsylvania', 'Philadelphia', 'United States', 'North America', 'needsVerification'),
  ('Cornell University', 'Ithaca', 'United States', 'North America', 'needsVerification'),
  ('Princeton University', 'Princeton', 'United States', 'North America', 'needsVerification'),
  ('Yale University', 'New Haven', 'United States', 'North America', 'needsVerification'),
  ('Duke University', 'Durham', 'United States', 'North America', 'needsVerification'),
  ('University of Chicago', 'Chicago', 'United States', 'North America', 'needsVerification'),
  ('University of Washington', 'Seattle', 'United States', 'North America', 'needsVerification'),
  ('University of Southern California', 'Los Angeles', 'United States', 'North America', 'needsVerification'),
  ('Georgia Institute of Technology', 'Atlanta', 'United States', 'North America', 'needsVerification'),
  ('Boston University', 'Boston', 'United States', 'North America', 'needsVerification'),
  ('Northeastern University', 'Boston', 'United States', 'North America', 'needsVerification'),
  ('Ohio State University', 'Columbus', 'United States', 'North America', 'needsVerification'),
  ('Penn State University', 'University Park', 'United States', 'North America', 'needsVerification'),
  ('Purdue University', 'West Lafayette', 'United States', 'North America', 'needsVerification'),
  ('University of Illinois Urbana-Champaign', 'Champaign', 'United States', 'North America', 'needsVerification'),
  ('University of Wisconsin-Madison', 'Madison', 'United States', 'North America', 'needsVerification'),
  ('University of Florida', 'Gainesville', 'United States', 'North America', 'needsVerification'),
  ('Arizona State University', 'Tempe', 'United States', 'North America', 'needsVerification'),
  ('University of Arizona', 'Tucson', 'United States', 'North America', 'needsVerification'),
  ('Texas A&M University', 'College Station', 'United States', 'North America', 'needsVerification'),
  ('University of Georgia', 'Athens', 'United States', 'North America', 'needsVerification'),
  ('University of North Carolina at Chapel Hill', 'Chapel Hill', 'United States', 'North America', 'needsVerification'),
  ('Indiana University Bloomington', 'Bloomington', 'United States', 'North America', 'needsVerification'),
  ('Michigan State University', 'East Lansing', 'United States', 'North America', 'needsVerification'),
  ('Rutgers University', 'New Brunswick', 'United States', 'North America', 'needsVerification'),
  ('University of Colorado Boulder', 'Boulder', 'United States', 'North America', 'needsVerification'),
  ('University of Virginia', 'Charlottesville', 'United States', 'North America', 'needsVerification'),
  ('University of Maryland', 'College Park', 'United States', 'North America', 'needsVerification'),
  ('University of Minnesota', 'Minneapolis', 'United States', 'North America', 'needsVerification'),
  ('San Diego State University', 'San Diego', 'United States', 'North America', 'needsVerification'),
  ('University of California, San Diego', 'San Diego', 'United States', 'North America', 'needsVerification'),
  ('University of California, Davis', 'Davis', 'United States', 'North America', 'needsVerification'),
  ('University of California, Irvine', 'Irvine', 'United States', 'North America', 'needsVerification'),
  ('Florida State University', 'Tallahassee', 'United States', 'North America', 'needsVerification'),
  ('University of Miami', 'Coral Gables', 'United States', 'North America', 'needsVerification'),
  ('University of Toronto', 'Toronto', 'Canada', 'North America', 'needsVerification'),
  ('University of British Columbia', 'Vancouver', 'Canada', 'North America', 'needsVerification'),
  ('McGill University', 'Montreal', 'Canada', 'North America', 'needsVerification'),
  ('University of Oxford', 'Oxford', 'United Kingdom', 'Europe', 'needsVerification'),
  ('University of Cambridge', 'Cambridge', 'United Kingdom', 'Europe', 'needsVerification'),
  ('Imperial College London', 'London', 'United Kingdom', 'Europe', 'needsVerification'),
  ('University College London', 'London', 'United Kingdom', 'Europe', 'needsVerification'),
  ('University of Edinburgh', 'Edinburgh', 'United Kingdom', 'Europe', 'needsVerification'),
  ('University of Sydney', 'Sydney', 'Australia', 'Oceania', 'needsVerification'),
  ('University of Melbourne', 'Melbourne', 'Australia', 'Oceania', 'needsVerification'),
  ('National University of Singapore', 'Singapore', 'Singapore', 'Asia', 'needsVerification')
on conflict (name) do nothing;
