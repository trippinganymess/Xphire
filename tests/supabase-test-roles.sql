-- Synthetic roles/schema for a disposable PostgreSQL CI container only.
create role anon;
create role authenticated;
create role service_role;
create schema auth;
create table auth.users (
  id uuid primary key,
  aud text,
  role text,
  email text,
  encrypted_password text
);
