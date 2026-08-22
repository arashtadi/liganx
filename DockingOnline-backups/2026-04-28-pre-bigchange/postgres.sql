--
-- PostgreSQL database dump
--

\restrict 89j0gKbV6k9nBLS4LVbIQ1IxnOmacSJXFrhJKpcVHFbBAjVod6hFnQTqr2TeLsY

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.3

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: auth; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA "auth";


--
-- Name: extensions; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA "extensions";


--
-- Name: graphql; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA "graphql";


--
-- Name: graphql_public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA "graphql_public";


--
-- Name: pgbouncer; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA "pgbouncer";


--
-- Name: SCHEMA "public"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA "public" IS 'standard public schema';


--
-- Name: realtime; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA "realtime";


--
-- Name: storage; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA "storage";


--
-- Name: vault; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA "vault";


--
-- Name: pg_stat_statements; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";


--
-- Name: EXTENSION "pg_stat_statements"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "pg_stat_statements" IS 'track planning and execution statistics of all SQL statements executed';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";


--
-- Name: EXTENSION "pgcrypto"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "pgcrypto" IS 'cryptographic functions';


--
-- Name: supabase_vault; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";


--
-- Name: EXTENSION "supabase_vault"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "supabase_vault" IS 'Supabase Vault Extension';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: aal_level; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE "auth"."aal_level" AS ENUM (
    'aal1',
    'aal2',
    'aal3'
);


--
-- Name: code_challenge_method; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE "auth"."code_challenge_method" AS ENUM (
    's256',
    'plain'
);


--
-- Name: factor_status; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE "auth"."factor_status" AS ENUM (
    'unverified',
    'verified'
);


--
-- Name: factor_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE "auth"."factor_type" AS ENUM (
    'totp',
    'webauthn',
    'phone'
);


--
-- Name: oauth_authorization_status; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE "auth"."oauth_authorization_status" AS ENUM (
    'pending',
    'approved',
    'denied',
    'expired'
);


--
-- Name: oauth_client_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE "auth"."oauth_client_type" AS ENUM (
    'public',
    'confidential'
);


--
-- Name: oauth_registration_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE "auth"."oauth_registration_type" AS ENUM (
    'dynamic',
    'manual'
);


--
-- Name: oauth_response_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE "auth"."oauth_response_type" AS ENUM (
    'code'
);


--
-- Name: one_time_token_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE "auth"."one_time_token_type" AS ENUM (
    'confirmation_token',
    'reauthentication_token',
    'recovery_token',
    'email_change_token_new',
    'email_change_token_current',
    'phone_change_token'
);


--
-- Name: jobstatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."jobstatus" AS ENUM (
    'PENDING',
    'RUNNING',
    'COMPLETED',
    'FAILED'
);


--
-- Name: action; Type: TYPE; Schema: realtime; Owner: -
--

CREATE TYPE "realtime"."action" AS ENUM (
    'INSERT',
    'UPDATE',
    'DELETE',
    'TRUNCATE',
    'ERROR'
);


--
-- Name: equality_op; Type: TYPE; Schema: realtime; Owner: -
--

CREATE TYPE "realtime"."equality_op" AS ENUM (
    'eq',
    'neq',
    'lt',
    'lte',
    'gt',
    'gte',
    'in'
);


--
-- Name: user_defined_filter; Type: TYPE; Schema: realtime; Owner: -
--

CREATE TYPE "realtime"."user_defined_filter" AS (
	"column_name" "text",
	"op" "realtime"."equality_op",
	"value" "text"
);


--
-- Name: wal_column; Type: TYPE; Schema: realtime; Owner: -
--

CREATE TYPE "realtime"."wal_column" AS (
	"name" "text",
	"type_name" "text",
	"type_oid" "oid",
	"value" "jsonb",
	"is_pkey" boolean,
	"is_selectable" boolean
);


--
-- Name: wal_rls; Type: TYPE; Schema: realtime; Owner: -
--

CREATE TYPE "realtime"."wal_rls" AS (
	"wal" "jsonb",
	"is_rls_enabled" boolean,
	"subscription_ids" "uuid"[],
	"errors" "text"[]
);


--
-- Name: buckettype; Type: TYPE; Schema: storage; Owner: -
--

CREATE TYPE "storage"."buckettype" AS ENUM (
    'STANDARD',
    'ANALYTICS',
    'VECTOR'
);


--
-- Name: email(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION "auth"."email"() RETURNS "text"
    LANGUAGE "sql" STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;


--
-- Name: FUNCTION "email"(); Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON FUNCTION "auth"."email"() IS 'Deprecated. Use auth.jwt() -> ''email'' instead.';


--
-- Name: jwt(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION "auth"."jwt"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    AS $$
  select 
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$$;


--
-- Name: role(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION "auth"."role"() RETURNS "text"
    LANGUAGE "sql" STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;


--
-- Name: FUNCTION "role"(); Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON FUNCTION "auth"."role"() IS 'Deprecated. Use auth.jwt() -> ''role'' instead.';


--
-- Name: uid(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION "auth"."uid"() RETURNS "uuid"
    LANGUAGE "sql" STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;


--
-- Name: FUNCTION "uid"(); Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON FUNCTION "auth"."uid"() IS 'Deprecated. Use auth.jwt() -> ''sub'' instead.';


--
-- Name: grant_pg_cron_access(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION "extensions"."grant_pg_cron_access"() RETURNS "event_trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF EXISTS (
    SELECT
    FROM pg_event_trigger_ddl_commands() AS ev
    JOIN pg_extension AS ext
    ON ev.objid = ext.oid
    WHERE ext.extname = 'pg_cron'
  )
  THEN
    grant usage on schema cron to postgres with grant option;

    alter default privileges in schema cron grant all on tables to postgres with grant option;
    alter default privileges in schema cron grant all on functions to postgres with grant option;
    alter default privileges in schema cron grant all on sequences to postgres with grant option;

    alter default privileges for user supabase_admin in schema cron grant all
        on sequences to postgres with grant option;
    alter default privileges for user supabase_admin in schema cron grant all
        on tables to postgres with grant option;
    alter default privileges for user supabase_admin in schema cron grant all
        on functions to postgres with grant option;

    grant all privileges on all tables in schema cron to postgres with grant option;
    revoke all on table cron.job from postgres;
    grant select on table cron.job to postgres with grant option;
  END IF;
END;
$$;


--
-- Name: FUNCTION "grant_pg_cron_access"(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION "extensions"."grant_pg_cron_access"() IS 'Grants access to pg_cron';


--
-- Name: grant_pg_graphql_access(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION "extensions"."grant_pg_graphql_access"() RETURNS "event_trigger"
    LANGUAGE "plpgsql"
    AS $_$
begin
    if not exists (
        select 1
        from pg_event_trigger_ddl_commands() ev
        join pg_catalog.pg_extension e on ev.objid = e.oid
        where e.extname = 'pg_graphql'
    ) then
        return;
    end if;

    drop function if exists graphql_public.graphql;
    create or replace function graphql_public.graphql(
        "operationName" text default null,
        query text default null,
        variables jsonb default null,
        extensions jsonb default null
    )
        returns jsonb
        language sql
    as $$
        select graphql.resolve(
            query := query,
            variables := coalesce(variables, '{}'),
            "operationName" := "operationName",
            extensions := extensions
        );
    $$;

    -- Attach the wrapper to the extension so DROP EXTENSION cascades to it,
    -- which in turn triggers set_graphql_placeholder to reinstall the "not enabled" stub.
    alter extension pg_graphql add function graphql_public.graphql(text, text, jsonb, jsonb);

    grant usage on schema graphql to postgres, anon, authenticated, service_role;
    grant execute on function graphql.resolve to postgres, anon, authenticated, service_role;
    grant usage on schema graphql to postgres with grant option;
    grant usage on schema graphql_public to postgres with grant option;
end;
$_$;


--
-- Name: FUNCTION "grant_pg_graphql_access"(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION "extensions"."grant_pg_graphql_access"() IS 'Grants access to pg_graphql';


--
-- Name: grant_pg_net_access(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION "extensions"."grant_pg_net_access"() RETURNS "event_trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_event_trigger_ddl_commands() AS ev
    JOIN pg_extension AS ext
    ON ev.objid = ext.oid
    WHERE ext.extname = 'pg_net'
  )
  THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_roles
      WHERE rolname = 'supabase_functions_admin'
    )
    THEN
      CREATE USER supabase_functions_admin NOINHERIT CREATEROLE LOGIN NOREPLICATION;
    END IF;

    GRANT USAGE ON SCHEMA net TO supabase_functions_admin, postgres, anon, authenticated, service_role;

    IF EXISTS (
      SELECT FROM pg_extension
      WHERE extname = 'pg_net'
      -- all versions in use on existing projects as of 2025-02-20
      -- version 0.12.0 onwards don't need these applied
      AND extversion IN ('0.2', '0.6', '0.7', '0.7.1', '0.8', '0.10.0', '0.11.0')
    ) THEN
      ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;
      ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;

      ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;
      ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;

      REVOKE ALL ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;
      REVOKE ALL ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;

      GRANT EXECUTE ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
    END IF;
  END IF;
END;
$$;


--
-- Name: FUNCTION "grant_pg_net_access"(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION "extensions"."grant_pg_net_access"() IS 'Grants access to pg_net';


--
-- Name: pgrst_ddl_watch(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION "extensions"."pgrst_ddl_watch"() RETURNS "event_trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN SELECT * FROM pg_event_trigger_ddl_commands()
  LOOP
    IF cmd.command_tag IN (
      'CREATE SCHEMA', 'ALTER SCHEMA'
    , 'CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO', 'ALTER TABLE'
    , 'CREATE FOREIGN TABLE', 'ALTER FOREIGN TABLE'
    , 'CREATE VIEW', 'ALTER VIEW'
    , 'CREATE MATERIALIZED VIEW', 'ALTER MATERIALIZED VIEW'
    , 'CREATE FUNCTION', 'ALTER FUNCTION'
    , 'CREATE TRIGGER'
    , 'CREATE TYPE', 'ALTER TYPE'
    , 'CREATE RULE'
    , 'COMMENT'
    )
    -- don't notify in case of CREATE TEMP table or other objects created on pg_temp
    AND cmd.schema_name is distinct from 'pg_temp'
    THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $$;


--
-- Name: pgrst_drop_watch(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION "extensions"."pgrst_drop_watch"() RETURNS "event_trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  obj record;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_dropped_objects()
  LOOP
    IF obj.object_type IN (
      'schema'
    , 'table'
    , 'foreign table'
    , 'view'
    , 'materialized view'
    , 'function'
    , 'trigger'
    , 'type'
    , 'rule'
    )
    AND obj.is_temporary IS false -- no pg_temp objects
    THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $$;


--
-- Name: set_graphql_placeholder(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION "extensions"."set_graphql_placeholder"() RETURNS "event_trigger"
    LANGUAGE "plpgsql"
    AS $_$
    DECLARE
    graphql_is_dropped bool;
    BEGIN
    graphql_is_dropped = (
        SELECT ev.schema_name = 'graphql_public'
        FROM pg_event_trigger_dropped_objects() AS ev
        WHERE ev.schema_name = 'graphql_public'
    );

    IF graphql_is_dropped
    THEN
        create or replace function graphql_public.graphql(
            "operationName" text default null,
            query text default null,
            variables jsonb default null,
            extensions jsonb default null
        )
            returns jsonb
            language plpgsql
        as $$
            DECLARE
                server_version float;
            BEGIN
                server_version = (SELECT (SPLIT_PART((select version()), ' ', 2))::float);

                IF server_version >= 14 THEN
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql extension is not enabled.'
                            )
                        )
                    );
                ELSE
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql is only available on projects running Postgres 14 onwards.'
                            )
                        )
                    );
                END IF;
            END;
        $$;
    END IF;

    END;
$_$;


--
-- Name: FUNCTION "set_graphql_placeholder"(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION "extensions"."set_graphql_placeholder"() IS 'Reintroduces placeholder function for graphql_public.graphql';


--
-- Name: graphql("text", "text", "jsonb", "jsonb"); Type: FUNCTION; Schema: graphql_public; Owner: -
--

CREATE FUNCTION "graphql_public"."graphql"("operationName" "text" DEFAULT NULL::"text", "query" "text" DEFAULT NULL::"text", "variables" "jsonb" DEFAULT NULL::"jsonb", "extensions" "jsonb" DEFAULT NULL::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$
            DECLARE
                server_version float;
            BEGIN
                server_version = (SELECT (SPLIT_PART((select version()), ' ', 2))::float);

                IF server_version >= 14 THEN
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql extension is not enabled.'
                            )
                        )
                    );
                ELSE
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql is only available on projects running Postgres 14 onwards.'
                            )
                        )
                    );
                END IF;
            END;
        $$;


--
-- Name: get_auth("text"); Type: FUNCTION; Schema: pgbouncer; Owner: -
--

CREATE FUNCTION "pgbouncer"."get_auth"("p_usename" "text") RETURNS TABLE("username" "text", "password" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
  BEGIN
      RAISE DEBUG 'PgBouncer auth request: %', p_usename;

      RETURN QUERY
      SELECT
          rolname::text,
          CASE WHEN rolvaliduntil < now()
              THEN null
              ELSE rolpassword::text
          END
      FROM pg_authid
      WHERE rolname=$1 and rolcanlogin;
  END;
  $_$;


--
-- Name: apply_rls("jsonb", integer); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION "realtime"."apply_rls"("wal" "jsonb", "max_record_bytes" integer DEFAULT (1024 * 1024)) RETURNS SETOF "realtime"."wal_rls"
    LANGUAGE "plpgsql"
    AS $$
declare
-- Regclass of the table e.g. public.notes
entity_ regclass = (quote_ident(wal ->> 'schema') || '.' || quote_ident(wal ->> 'table'))::regclass;

-- I, U, D, T: insert, update ...
action realtime.action = (
    case wal ->> 'action'
        when 'I' then 'INSERT'
        when 'U' then 'UPDATE'
        when 'D' then 'DELETE'
        else 'ERROR'
    end
);

-- Is row level security enabled for the table
is_rls_enabled bool = relrowsecurity from pg_class where oid = entity_;

subscriptions realtime.subscription[] = array_agg(subs)
    from
        realtime.subscription subs
    where
        subs.entity = entity_
        -- Filter by action early - only get subscriptions interested in this action
        -- action_filter column can be: '*' (all), 'INSERT', 'UPDATE', or 'DELETE'
        and (subs.action_filter = '*' or subs.action_filter = action::text);

-- Subscription vars
roles regrole[] = array_agg(distinct us.claims_role::text)
    from
        unnest(subscriptions) us;

working_role regrole;
claimed_role regrole;
claims jsonb;

subscription_id uuid;
subscription_has_access bool;
visible_to_subscription_ids uuid[] = '{}';

-- structured info for wal's columns
columns realtime.wal_column[];
-- previous identity values for update/delete
old_columns realtime.wal_column[];

error_record_exceeds_max_size boolean = octet_length(wal::text) > max_record_bytes;

-- Primary jsonb output for record
output jsonb;

begin
perform set_config('role', null, true);

columns =
    array_agg(
        (
            x->>'name',
            x->>'type',
            x->>'typeoid',
            realtime.cast(
                (x->'value') #>> '{}',
                coalesce(
                    (x->>'typeoid')::regtype, -- null when wal2json version <= 2.4
                    (x->>'type')::regtype
                )
            ),
            (pks ->> 'name') is not null,
            true
        )::realtime.wal_column
    )
    from
        jsonb_array_elements(wal -> 'columns') x
        left join jsonb_array_elements(wal -> 'pk') pks
            on (x ->> 'name') = (pks ->> 'name');

old_columns =
    array_agg(
        (
            x->>'name',
            x->>'type',
            x->>'typeoid',
            realtime.cast(
                (x->'value') #>> '{}',
                coalesce(
                    (x->>'typeoid')::regtype, -- null when wal2json version <= 2.4
                    (x->>'type')::regtype
                )
            ),
            (pks ->> 'name') is not null,
            true
        )::realtime.wal_column
    )
    from
        jsonb_array_elements(wal -> 'identity') x
        left join jsonb_array_elements(wal -> 'pk') pks
            on (x ->> 'name') = (pks ->> 'name');

for working_role in select * from unnest(roles) loop

    -- Update `is_selectable` for columns and old_columns
    columns =
        array_agg(
            (
                c.name,
                c.type_name,
                c.type_oid,
                c.value,
                c.is_pkey,
                pg_catalog.has_column_privilege(working_role, entity_, c.name, 'SELECT')
            )::realtime.wal_column
        )
        from
            unnest(columns) c;

    old_columns =
            array_agg(
                (
                    c.name,
                    c.type_name,
                    c.type_oid,
                    c.value,
                    c.is_pkey,
                    pg_catalog.has_column_privilege(working_role, entity_, c.name, 'SELECT')
                )::realtime.wal_column
            )
            from
                unnest(old_columns) c;

    if action <> 'DELETE' and count(1) = 0 from unnest(columns) c where c.is_pkey then
        return next (
            jsonb_build_object(
                'schema', wal ->> 'schema',
                'table', wal ->> 'table',
                'type', action
            ),
            is_rls_enabled,
            -- subscriptions is already filtered by entity
            (select array_agg(s.subscription_id) from unnest(subscriptions) as s where claims_role = working_role),
            array['Error 400: Bad Request, no primary key']
        )::realtime.wal_rls;

    -- The claims role does not have SELECT permission to the primary key of entity
    elsif action <> 'DELETE' and sum(c.is_selectable::int) <> count(1) from unnest(columns) c where c.is_pkey then
        return next (
            jsonb_build_object(
                'schema', wal ->> 'schema',
                'table', wal ->> 'table',
                'type', action
            ),
            is_rls_enabled,
            (select array_agg(s.subscription_id) from unnest(subscriptions) as s where claims_role = working_role),
            array['Error 401: Unauthorized']
        )::realtime.wal_rls;

    else
        output = jsonb_build_object(
            'schema', wal ->> 'schema',
            'table', wal ->> 'table',
            'type', action,
            'commit_timestamp', to_char(
                ((wal ->> 'timestamp')::timestamptz at time zone 'utc'),
                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            ),
            'columns', (
                select
                    jsonb_agg(
                        jsonb_build_object(
                            'name', pa.attname,
                            'type', pt.typname
                        )
                        order by pa.attnum asc
                    )
                from
                    pg_attribute pa
                    join pg_type pt
                        on pa.atttypid = pt.oid
                where
                    attrelid = entity_
                    and attnum > 0
                    and pg_catalog.has_column_privilege(working_role, entity_, pa.attname, 'SELECT')
            )
        )
        -- Add "record" key for insert and update
        || case
            when action in ('INSERT', 'UPDATE') then
                jsonb_build_object(
                    'record',
                    (
                        select
                            jsonb_object_agg(
                                -- if unchanged toast, get column name and value from old record
                                coalesce((c).name, (oc).name),
                                case
                                    when (c).name is null then (oc).value
                                    else (c).value
                                end
                            )
                        from
                            unnest(columns) c
                            full outer join unnest(old_columns) oc
                                on (c).name = (oc).name
                        where
                            coalesce((c).is_selectable, (oc).is_selectable)
                            and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                    )
                )
            else '{}'::jsonb
        end
        -- Add "old_record" key for update and delete
        || case
            when action = 'UPDATE' then
                jsonb_build_object(
                        'old_record',
                        (
                            select jsonb_object_agg((c).name, (c).value)
                            from unnest(old_columns) c
                            where
                                (c).is_selectable
                                and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                        )
                    )
            when action = 'DELETE' then
                jsonb_build_object(
                    'old_record',
                    (
                        select jsonb_object_agg((c).name, (c).value)
                        from unnest(old_columns) c
                        where
                            (c).is_selectable
                            and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                            and ( not is_rls_enabled or (c).is_pkey ) -- if RLS enabled, we can't secure deletes so filter to pkey
                    )
                )
            else '{}'::jsonb
        end;

        -- Create the prepared statement
        if is_rls_enabled and action <> 'DELETE' then
            if (select 1 from pg_prepared_statements where name = 'walrus_rls_stmt' limit 1) > 0 then
                deallocate walrus_rls_stmt;
            end if;
            execute realtime.build_prepared_statement_sql('walrus_rls_stmt', entity_, columns);
        end if;

        visible_to_subscription_ids = '{}';

        for subscription_id, claims in (
                select
                    subs.subscription_id,
                    subs.claims
                from
                    unnest(subscriptions) subs
                where
                    subs.entity = entity_
                    and subs.claims_role = working_role
                    and (
                        realtime.is_visible_through_filters(columns, subs.filters)
                        or (
                          action = 'DELETE'
                          and realtime.is_visible_through_filters(old_columns, subs.filters)
                        )
                    )
        ) loop

            if not is_rls_enabled or action = 'DELETE' then
                visible_to_subscription_ids = visible_to_subscription_ids || subscription_id;
            else
                -- Check if RLS allows the role to see the record
                perform
                    -- Trim leading and trailing quotes from working_role because set_config
                    -- doesn't recognize the role as valid if they are included
                    set_config('role', trim(both '"' from working_role::text), true),
                    set_config('request.jwt.claims', claims::text, true);

                execute 'execute walrus_rls_stmt' into subscription_has_access;

                if subscription_has_access then
                    visible_to_subscription_ids = visible_to_subscription_ids || subscription_id;
                end if;
            end if;
        end loop;

        perform set_config('role', null, true);

        return next (
            output,
            is_rls_enabled,
            visible_to_subscription_ids,
            case
                when error_record_exceeds_max_size then array['Error 413: Payload Too Large']
                else '{}'
            end
        )::realtime.wal_rls;

    end if;
end loop;

perform set_config('role', null, true);
end;
$$;


--
-- Name: broadcast_changes("text", "text", "text", "text", "text", "record", "record", "text"); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION "realtime"."broadcast_changes"("topic_name" "text", "event_name" "text", "operation" "text", "table_name" "text", "table_schema" "text", "new" "record", "old" "record", "level" "text" DEFAULT 'ROW'::"text") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    -- Declare a variable to hold the JSONB representation of the row
    row_data jsonb := '{}'::jsonb;
BEGIN
    IF level = 'STATEMENT' THEN
        RAISE EXCEPTION 'function can only be triggered for each row, not for each statement';
    END IF;
    -- Check the operation type and handle accordingly
    IF operation = 'INSERT' OR operation = 'UPDATE' OR operation = 'DELETE' THEN
        row_data := jsonb_build_object('old_record', OLD, 'record', NEW, 'operation', operation, 'table', table_name, 'schema', table_schema);
        PERFORM realtime.send (row_data, event_name, topic_name);
    ELSE
        RAISE EXCEPTION 'Unexpected operation type: %', operation;
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Failed to process the row: %', SQLERRM;
END;

$$;


--
-- Name: build_prepared_statement_sql("text", "regclass", "realtime"."wal_column"[]); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION "realtime"."build_prepared_statement_sql"("prepared_statement_name" "text", "entity" "regclass", "columns" "realtime"."wal_column"[]) RETURNS "text"
    LANGUAGE "sql"
    AS $$
      /*
      Builds a sql string that, if executed, creates a prepared statement to
      tests retrive a row from *entity* by its primary key columns.
      Example
          select realtime.build_prepared_statement_sql('public.notes', '{"id"}'::text[], '{"bigint"}'::text[])
      */
          select
      'prepare ' || prepared_statement_name || ' as
          select
              exists(
                  select
                      1
                  from
                      ' || entity || '
                  where
                      ' || string_agg(quote_ident(pkc.name) || '=' || quote_nullable(pkc.value #>> '{}') , ' and ') || '
              )'
          from
              unnest(columns) pkc
          where
              pkc.is_pkey
          group by
              entity
      $$;


--
-- Name: cast("text", "regtype"); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION "realtime"."cast"("val" "text", "type_" "regtype") RETURNS "jsonb"
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
declare
  res jsonb;
begin
  if type_::text = 'bytea' then
    return to_jsonb(val);
  end if;
  execute format('select to_jsonb(%L::'|| type_::text || ')', val) into res;
  return res;
end
$$;


--
-- Name: check_equality_op("realtime"."equality_op", "regtype", "text", "text"); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION "realtime"."check_equality_op"("op" "realtime"."equality_op", "type_" "regtype", "val_1" "text", "val_2" "text") RETURNS boolean
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
      /*
      Casts *val_1* and *val_2* as type *type_* and check the *op* condition for truthiness
      */
      declare
          op_symbol text = (
              case
                  when op = 'eq' then '='
                  when op = 'neq' then '!='
                  when op = 'lt' then '<'
                  when op = 'lte' then '<='
                  when op = 'gt' then '>'
                  when op = 'gte' then '>='
                  when op = 'in' then '= any'
                  else 'UNKNOWN OP'
              end
          );
          res boolean;
      begin
          execute format(
              'select %L::'|| type_::text || ' ' || op_symbol
              || ' ( %L::'
              || (
                  case
                      when op = 'in' then type_::text || '[]'
                      else type_::text end
              )
              || ')', val_1, val_2) into res;
          return res;
      end;
      $$;


--
-- Name: is_visible_through_filters("realtime"."wal_column"[], "realtime"."user_defined_filter"[]); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION "realtime"."is_visible_through_filters"("columns" "realtime"."wal_column"[], "filters" "realtime"."user_defined_filter"[]) RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    AS $_$
    /*
    Should the record be visible (true) or filtered out (false) after *filters* are applied
    */
        select
            -- Default to allowed when no filters present
            $2 is null -- no filters. this should not happen because subscriptions has a default
            or array_length($2, 1) is null -- array length of an empty array is null
            or bool_and(
                coalesce(
                    realtime.check_equality_op(
                        op:=f.op,
                        type_:=coalesce(
                            col.type_oid::regtype, -- null when wal2json version <= 2.4
                            col.type_name::regtype
                        ),
                        -- cast jsonb to text
                        val_1:=col.value #>> '{}',
                        val_2:=f.value
                    ),
                    false -- if null, filter does not match
                )
            )
        from
            unnest(filters) f
            join unnest(columns) col
                on f.column_name = col.name;
    $_$;


--
-- Name: list_changes("name", "name", integer, integer); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION "realtime"."list_changes"("publication" "name", "slot_name" "name", "max_changes" integer, "max_record_bytes" integer) RETURNS TABLE("wal" "jsonb", "is_rls_enabled" boolean, "subscription_ids" "uuid"[], "errors" "text"[], "slot_changes_count" bigint)
    LANGUAGE "sql"
    SET "log_min_messages" TO 'fatal'
    AS $$
  WITH pub AS (
    SELECT
      concat_ws(
        ',',
        CASE WHEN bool_or(pubinsert) THEN 'insert' ELSE NULL END,
        CASE WHEN bool_or(pubupdate) THEN 'update' ELSE NULL END,
        CASE WHEN bool_or(pubdelete) THEN 'delete' ELSE NULL END
      ) AS w2j_actions,
      coalesce(
        string_agg(
          realtime.quote_wal2json(format('%I.%I', schemaname, tablename)::regclass),
          ','
        ) filter (WHERE ppt.tablename IS NOT NULL AND ppt.tablename NOT LIKE '% %'),
        ''
      ) AS w2j_add_tables
    FROM pg_publication pp
    LEFT JOIN pg_publication_tables ppt ON pp.pubname = ppt.pubname
    WHERE pp.pubname = publication
    GROUP BY pp.pubname
    LIMIT 1
  ),
  -- MATERIALIZED ensures pg_logical_slot_get_changes is called exactly once
  w2j AS MATERIALIZED (
    SELECT x.*, pub.w2j_add_tables
    FROM pub,
         pg_logical_slot_get_changes(
           slot_name, null, max_changes,
           'include-pk', 'true',
           'include-transaction', 'false',
           'include-timestamp', 'true',
           'include-type-oids', 'true',
           'format-version', '2',
           'actions', pub.w2j_actions,
           'add-tables', pub.w2j_add_tables
         ) x
  ),
  -- Count raw slot entries before apply_rls/subscription filter
  slot_count AS (
    SELECT count(*)::bigint AS cnt
    FROM w2j
    WHERE w2j.w2j_add_tables <> ''
  ),
  -- Apply RLS and filter as before
  rls_filtered AS (
    SELECT xyz.wal, xyz.is_rls_enabled, xyz.subscription_ids, xyz.errors
    FROM w2j,
         realtime.apply_rls(
           wal := w2j.data::jsonb,
           max_record_bytes := max_record_bytes
         ) xyz(wal, is_rls_enabled, subscription_ids, errors)
    WHERE w2j.w2j_add_tables <> ''
      AND xyz.subscription_ids[1] IS NOT NULL
  )
  -- Real rows with slot count attached
  SELECT rf.wal, rf.is_rls_enabled, rf.subscription_ids, rf.errors, sc.cnt
  FROM rls_filtered rf, slot_count sc

  UNION ALL

  -- Sentinel row: always returned when no real rows exist so Elixir can
  -- always read slot_changes_count. Identified by wal IS NULL.
  SELECT null, null, null, null, sc.cnt
  FROM slot_count sc
  WHERE NOT EXISTS (SELECT 1 FROM rls_filtered)
$$;


--
-- Name: quote_wal2json("regclass"); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION "realtime"."quote_wal2json"("entity" "regclass") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE STRICT
    AS $$
      select
        (
          select string_agg('' || ch,'')
          from unnest(string_to_array(nsp.nspname::text, null)) with ordinality x(ch, idx)
          where
            not (x.idx = 1 and x.ch = '"')
            and not (
              x.idx = array_length(string_to_array(nsp.nspname::text, null), 1)
              and x.ch = '"'
            )
        )
        || '.'
        || (
          select string_agg('' || ch,'')
          from unnest(string_to_array(pc.relname::text, null)) with ordinality x(ch, idx)
          where
            not (x.idx = 1 and x.ch = '"')
            and not (
              x.idx = array_length(string_to_array(nsp.nspname::text, null), 1)
              and x.ch = '"'
            )
          )
      from
        pg_class pc
        join pg_namespace nsp
          on pc.relnamespace = nsp.oid
      where
        pc.oid = entity
    $$;


--
-- Name: send("jsonb", "text", "text", boolean); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION "realtime"."send"("payload" "jsonb", "event" "text", "topic" "text", "private" boolean DEFAULT true) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  generated_id uuid;
  final_payload jsonb;
BEGIN
  BEGIN
    -- Generate a new UUID for the id
    generated_id := gen_random_uuid();

    -- Check if payload has an 'id' key, if not, add the generated UUID
    IF payload ? 'id' THEN
      final_payload := payload;
    ELSE
      final_payload := jsonb_set(payload, '{id}', to_jsonb(generated_id));
    END IF;

    -- Set the topic configuration
    EXECUTE format('SET LOCAL realtime.topic TO %L', topic);

    -- Attempt to insert the message
    INSERT INTO realtime.messages (id, payload, event, topic, private, extension)
    VALUES (generated_id, final_payload, event, topic, private, 'broadcast');
  EXCEPTION
    WHEN OTHERS THEN
      -- Capture and notify the error
      RAISE WARNING 'ErrorSendingBroadcastMessage: %', SQLERRM;
  END;
END;
$$;


--
-- Name: subscription_check_filters(); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION "realtime"."subscription_check_filters"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
    /*
    Validates that the user defined filters for a subscription:
    - refer to valid columns that the claimed role may access
    - values are coercable to the correct column type
    */
    declare
        col_names text[] = coalesce(
                array_agg(c.column_name order by c.ordinal_position),
                '{}'::text[]
            )
            from
                information_schema.columns c
            where
                format('%I.%I', c.table_schema, c.table_name)::regclass = new.entity
                and pg_catalog.has_column_privilege(
                    (new.claims ->> 'role'),
                    format('%I.%I', c.table_schema, c.table_name)::regclass,
                    c.column_name,
                    'SELECT'
                );
        filter realtime.user_defined_filter;
        col_type regtype;

        in_val jsonb;
    begin
        for filter in select * from unnest(new.filters) loop
            -- Filtered column is valid
            if not filter.column_name = any(col_names) then
                raise exception 'invalid column for filter %', filter.column_name;
            end if;

            -- Type is sanitized and safe for string interpolation
            col_type = (
                select atttypid::regtype
                from pg_catalog.pg_attribute
                where attrelid = new.entity
                      and attname = filter.column_name
            );
            if col_type is null then
                raise exception 'failed to lookup type for column %', filter.column_name;
            end if;

            -- Set maximum number of entries for in filter
            if filter.op = 'in'::realtime.equality_op then
                in_val = realtime.cast(filter.value, (col_type::text || '[]')::regtype);
                if coalesce(jsonb_array_length(in_val), 0) > 100 then
                    raise exception 'too many values for `in` filter. Maximum 100';
                end if;
            else
                -- raises an exception if value is not coercable to type
                perform realtime.cast(filter.value, col_type);
            end if;

        end loop;

        -- Apply consistent order to filters so the unique constraint on
        -- (subscription_id, entity, filters) can't be tricked by a different filter order
        new.filters = coalesce(
            array_agg(f order by f.column_name, f.op, f.value),
            '{}'
        ) from unnest(new.filters) f;

        return new;
    end;
    $$;


--
-- Name: to_regrole("text"); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION "realtime"."to_regrole"("role_name" "text") RETURNS "regrole"
    LANGUAGE "sql" IMMUTABLE
    AS $$ select role_name::regrole $$;


--
-- Name: topic(); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION "realtime"."topic"() RETURNS "text"
    LANGUAGE "sql" STABLE
    AS $$
select nullif(current_setting('realtime.topic', true), '')::text;
$$;


--
-- Name: allow_any_operation("text"[]); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION "storage"."allow_any_operation"("expected_operations" "text"[]) RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  WITH current_operation AS (
    SELECT storage.operation() AS raw_operation
  ),
  normalized AS (
    SELECT CASE
      WHEN raw_operation LIKE 'storage.%' THEN substr(raw_operation, 9)
      ELSE raw_operation
    END AS current_operation
    FROM current_operation
  )
  SELECT EXISTS (
    SELECT 1
    FROM normalized n
    CROSS JOIN LATERAL unnest(expected_operations) AS expected_operation
    WHERE expected_operation IS NOT NULL
      AND expected_operation <> ''
      AND n.current_operation = CASE
        WHEN expected_operation LIKE 'storage.%' THEN substr(expected_operation, 9)
        ELSE expected_operation
      END
  );
$$;


--
-- Name: allow_only_operation("text"); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION "storage"."allow_only_operation"("expected_operation" "text") RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  WITH current_operation AS (
    SELECT storage.operation() AS raw_operation
  ),
  normalized AS (
    SELECT
      CASE
        WHEN raw_operation LIKE 'storage.%' THEN substr(raw_operation, 9)
        ELSE raw_operation
      END AS current_operation,
      CASE
        WHEN expected_operation LIKE 'storage.%' THEN substr(expected_operation, 9)
        ELSE expected_operation
      END AS requested_operation
    FROM current_operation
  )
  SELECT CASE
    WHEN requested_operation IS NULL OR requested_operation = '' THEN FALSE
    ELSE COALESCE(current_operation = requested_operation, FALSE)
  END
  FROM normalized;
$$;


--
-- Name: can_insert_object("text", "text", "uuid", "jsonb"); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION "storage"."can_insert_object"("bucketid" "text", "name" "text", "owner" "uuid", "metadata" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  INSERT INTO "storage"."objects" ("bucket_id", "name", "owner", "metadata") VALUES (bucketid, name, owner, metadata);
  -- hack to rollback the successful insert
  RAISE sqlstate 'PT200' using
  message = 'ROLLBACK',
  detail = 'rollback successful insert';
END
$$;


--
-- Name: enforce_bucket_name_length(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION "storage"."enforce_bucket_name_length"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
    if length(new.name) > 100 then
        raise exception 'bucket name "%" is too long (% characters). Max is 100.', new.name, length(new.name);
    end if;
    return new;
end;
$$;


--
-- Name: extension("text"); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION "storage"."extension"("name" "text") RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
_parts text[];
_filename text;
BEGIN
	select string_to_array(name, '/') into _parts;
	select _parts[array_length(_parts,1)] into _filename;
	-- @todo return the last part instead of 2
	return reverse(split_part(reverse(_filename), '.', 1));
END
$$;


--
-- Name: filename("text"); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION "storage"."filename"("name" "text") RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
_parts text[];
BEGIN
	select string_to_array(name, '/') into _parts;
	return _parts[array_length(_parts,1)];
END
$$;


--
-- Name: foldername("text"); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION "storage"."foldername"("name" "text") RETURNS "text"[]
    LANGUAGE "plpgsql"
    AS $$
DECLARE
_parts text[];
BEGIN
	select string_to_array(name, '/') into _parts;
	return _parts[1:array_length(_parts,1)-1];
END
$$;


--
-- Name: get_common_prefix("text", "text", "text"); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION "storage"."get_common_prefix"("p_key" "text", "p_prefix" "text", "p_delimiter" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
SELECT CASE
    WHEN position(p_delimiter IN substring(p_key FROM length(p_prefix) + 1)) > 0
    THEN left(p_key, length(p_prefix) + position(p_delimiter IN substring(p_key FROM length(p_prefix) + 1)))
    ELSE NULL
END;
$$;


--
-- Name: get_size_by_bucket(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION "storage"."get_size_by_bucket"() RETURNS TABLE("size" bigint, "bucket_id" "text")
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    return query
        select sum((metadata->>'size')::int) as size, obj.bucket_id
        from "storage".objects as obj
        group by obj.bucket_id;
END
$$;


--
-- Name: list_multipart_uploads_with_delimiter("text", "text", "text", integer, "text", "text"); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION "storage"."list_multipart_uploads_with_delimiter"("bucket_id" "text", "prefix_param" "text", "delimiter_param" "text", "max_keys" integer DEFAULT 100, "next_key_token" "text" DEFAULT ''::"text", "next_upload_token" "text" DEFAULT ''::"text") RETURNS TABLE("key" "text", "id" "text", "created_at" timestamp with time zone)
    LANGUAGE "plpgsql"
    AS $_$
BEGIN
    RETURN QUERY EXECUTE
        'SELECT DISTINCT ON(key COLLATE "C") * from (
            SELECT
                CASE
                    WHEN position($2 IN substring(key from length($1) + 1)) > 0 THEN
                        substring(key from 1 for length($1) + position($2 IN substring(key from length($1) + 1)))
                    ELSE
                        key
                END AS key, id, created_at
            FROM
                storage.s3_multipart_uploads
            WHERE
                bucket_id = $5 AND
                key ILIKE $1 || ''%'' AND
                CASE
                    WHEN $4 != '''' AND $6 = '''' THEN
                        CASE
                            WHEN position($2 IN substring(key from length($1) + 1)) > 0 THEN
                                substring(key from 1 for length($1) + position($2 IN substring(key from length($1) + 1))) COLLATE "C" > $4
                            ELSE
                                key COLLATE "C" > $4
                            END
                    ELSE
                        true
                END AND
                CASE
                    WHEN $6 != '''' THEN
                        id COLLATE "C" > $6
                    ELSE
                        true
                    END
            ORDER BY
                key COLLATE "C" ASC, created_at ASC) as e order by key COLLATE "C" LIMIT $3'
        USING prefix_param, delimiter_param, max_keys, next_key_token, bucket_id, next_upload_token;
END;
$_$;


--
-- Name: list_objects_with_delimiter("text", "text", "text", integer, "text", "text", "text"); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION "storage"."list_objects_with_delimiter"("_bucket_id" "text", "prefix_param" "text", "delimiter_param" "text", "max_keys" integer DEFAULT 100, "start_after" "text" DEFAULT ''::"text", "next_token" "text" DEFAULT ''::"text", "sort_order" "text" DEFAULT 'asc'::"text") RETURNS TABLE("name" "text", "id" "uuid", "metadata" "jsonb", "updated_at" timestamp with time zone, "created_at" timestamp with time zone, "last_accessed_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE
    AS $_$
DECLARE
    v_peek_name TEXT;
    v_current RECORD;
    v_common_prefix TEXT;

    -- Configuration
    v_is_asc BOOLEAN;
    v_prefix TEXT;
    v_start TEXT;
    v_upper_bound TEXT;
    v_file_batch_size INT;

    -- Seek state
    v_next_seek TEXT;
    v_count INT := 0;

    -- Dynamic SQL for batch query only
    v_batch_query TEXT;

BEGIN
    -- ========================================================================
    -- INITIALIZATION
    -- ========================================================================
    v_is_asc := lower(coalesce(sort_order, 'asc')) = 'asc';
    v_prefix := coalesce(prefix_param, '');
    v_start := CASE WHEN coalesce(next_token, '') <> '' THEN next_token ELSE coalesce(start_after, '') END;
    v_file_batch_size := LEAST(GREATEST(max_keys * 2, 100), 1000);

    -- Calculate upper bound for prefix filtering (bytewise, using COLLATE "C")
    IF v_prefix = '' THEN
        v_upper_bound := NULL;
    ELSIF right(v_prefix, 1) = delimiter_param THEN
        v_upper_bound := left(v_prefix, -1) || chr(ascii(delimiter_param) + 1);
    ELSE
        v_upper_bound := left(v_prefix, -1) || chr(ascii(right(v_prefix, 1)) + 1);
    END IF;

    -- Build batch query (dynamic SQL - called infrequently, amortized over many rows)
    IF v_is_asc THEN
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" >= $2 ' ||
                'AND o.name COLLATE "C" < $3 ORDER BY o.name COLLATE "C" ASC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" >= $2 ' ||
                'ORDER BY o.name COLLATE "C" ASC LIMIT $4';
        END IF;
    ELSE
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" < $2 ' ||
                'AND o.name COLLATE "C" >= $3 ORDER BY o.name COLLATE "C" DESC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" < $2 ' ||
                'ORDER BY o.name COLLATE "C" DESC LIMIT $4';
        END IF;
    END IF;

    -- ========================================================================
    -- SEEK INITIALIZATION: Determine starting position
    -- ========================================================================
    IF v_start = '' THEN
        IF v_is_asc THEN
            v_next_seek := v_prefix;
        ELSE
            -- DESC without cursor: find the last item in range
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_prefix AND o.name COLLATE "C" < v_upper_bound
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix <> '' THEN
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            END IF;

            IF v_next_seek IS NOT NULL THEN
                v_next_seek := v_next_seek || delimiter_param;
            ELSE
                RETURN;
            END IF;
        END IF;
    ELSE
        -- Cursor provided: determine if it refers to a folder or leaf
        IF EXISTS (
            SELECT 1 FROM storage.objects o
            WHERE o.bucket_id = _bucket_id
              AND o.name COLLATE "C" LIKE v_start || delimiter_param || '%'
            LIMIT 1
        ) THEN
            -- Cursor refers to a folder
            IF v_is_asc THEN
                v_next_seek := v_start || chr(ascii(delimiter_param) + 1);
            ELSE
                v_next_seek := v_start || delimiter_param;
            END IF;
        ELSE
            -- Cursor refers to a leaf object
            IF v_is_asc THEN
                v_next_seek := v_start || delimiter_param;
            ELSE
                v_next_seek := v_start;
            END IF;
        END IF;
    END IF;

    -- ========================================================================
    -- MAIN LOOP: Hybrid peek-then-batch algorithm
    -- Uses STATIC SQL for peek (hot path) and DYNAMIC SQL for batch
    -- ========================================================================
    LOOP
        EXIT WHEN v_count >= max_keys;

        -- STEP 1: PEEK using STATIC SQL (plan cached, very fast)
        IF v_is_asc THEN
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_next_seek AND o.name COLLATE "C" < v_upper_bound
                ORDER BY o.name COLLATE "C" ASC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_next_seek
                ORDER BY o.name COLLATE "C" ASC LIMIT 1;
            END IF;
        ELSE
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix <> '' THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            END IF;
        END IF;

        EXIT WHEN v_peek_name IS NULL;

        -- STEP 2: Check if this is a FOLDER or FILE
        v_common_prefix := storage.get_common_prefix(v_peek_name, v_prefix, delimiter_param);

        IF v_common_prefix IS NOT NULL THEN
            -- FOLDER: Emit and skip to next folder (no heap access needed)
            name := rtrim(v_common_prefix, delimiter_param);
            id := NULL;
            updated_at := NULL;
            created_at := NULL;
            last_accessed_at := NULL;
            metadata := NULL;
            RETURN NEXT;
            v_count := v_count + 1;

            -- Advance seek past the folder range
            IF v_is_asc THEN
                v_next_seek := left(v_common_prefix, -1) || chr(ascii(delimiter_param) + 1);
            ELSE
                v_next_seek := v_common_prefix;
            END IF;
        ELSE
            -- FILE: Batch fetch using DYNAMIC SQL (overhead amortized over many rows)
            -- For ASC: upper_bound is the exclusive upper limit (< condition)
            -- For DESC: prefix is the inclusive lower limit (>= condition)
            FOR v_current IN EXECUTE v_batch_query USING _bucket_id, v_next_seek,
                CASE WHEN v_is_asc THEN COALESCE(v_upper_bound, v_prefix) ELSE v_prefix END, v_file_batch_size
            LOOP
                v_common_prefix := storage.get_common_prefix(v_current.name, v_prefix, delimiter_param);

                IF v_common_prefix IS NOT NULL THEN
                    -- Hit a folder: exit batch, let peek handle it
                    v_next_seek := v_current.name;
                    EXIT;
                END IF;

                -- Emit file
                name := v_current.name;
                id := v_current.id;
                updated_at := v_current.updated_at;
                created_at := v_current.created_at;
                last_accessed_at := v_current.last_accessed_at;
                metadata := v_current.metadata;
                RETURN NEXT;
                v_count := v_count + 1;

                -- Advance seek past this file
                IF v_is_asc THEN
                    v_next_seek := v_current.name || delimiter_param;
                ELSE
                    v_next_seek := v_current.name;
                END IF;

                EXIT WHEN v_count >= max_keys;
            END LOOP;
        END IF;
    END LOOP;
END;
$_$;


--
-- Name: operation(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION "storage"."operation"() RETURNS "text"
    LANGUAGE "plpgsql" STABLE
    AS $$
BEGIN
    RETURN current_setting('storage.operation', true);
END;
$$;


--
-- Name: protect_delete(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION "storage"."protect_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    -- Check if storage.allow_delete_query is set to 'true'
    IF COALESCE(current_setting('storage.allow_delete_query', true), 'false') != 'true' THEN
        RAISE EXCEPTION 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
            USING HINT = 'This prevents accidental data loss from orphaned objects.',
                  ERRCODE = '42501';
    END IF;
    RETURN NULL;
END;
$$;


--
-- Name: search("text", "text", integer, integer, integer, "text", "text", "text"); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION "storage"."search"("prefix" "text", "bucketname" "text", "limits" integer DEFAULT 100, "levels" integer DEFAULT 1, "offsets" integer DEFAULT 0, "search" "text" DEFAULT ''::"text", "sortcolumn" "text" DEFAULT 'name'::"text", "sortorder" "text" DEFAULT 'asc'::"text") RETURNS TABLE("name" "text", "id" "uuid", "updated_at" timestamp with time zone, "created_at" timestamp with time zone, "last_accessed_at" timestamp with time zone, "metadata" "jsonb")
    LANGUAGE "plpgsql" STABLE
    AS $_$
DECLARE
    v_peek_name TEXT;
    v_current RECORD;
    v_common_prefix TEXT;
    v_delimiter CONSTANT TEXT := '/';

    -- Configuration
    v_limit INT;
    v_prefix TEXT;
    v_prefix_lower TEXT;
    v_is_asc BOOLEAN;
    v_order_by TEXT;
    v_sort_order TEXT;
    v_upper_bound TEXT;
    v_file_batch_size INT;

    -- Dynamic SQL for batch query only
    v_batch_query TEXT;

    -- Seek state
    v_next_seek TEXT;
    v_count INT := 0;
    v_skipped INT := 0;
BEGIN
    -- ========================================================================
    -- INITIALIZATION
    -- ========================================================================
    v_limit := LEAST(coalesce(limits, 100), 1500);
    v_prefix := coalesce(prefix, '') || coalesce(search, '');
    v_prefix_lower := lower(v_prefix);
    v_is_asc := lower(coalesce(sortorder, 'asc')) = 'asc';
    v_file_batch_size := LEAST(GREATEST(v_limit * 2, 100), 1000);

    -- Validate sort column
    CASE lower(coalesce(sortcolumn, 'name'))
        WHEN 'name' THEN v_order_by := 'name';
        WHEN 'updated_at' THEN v_order_by := 'updated_at';
        WHEN 'created_at' THEN v_order_by := 'created_at';
        WHEN 'last_accessed_at' THEN v_order_by := 'last_accessed_at';
        ELSE v_order_by := 'name';
    END CASE;

    v_sort_order := CASE WHEN v_is_asc THEN 'asc' ELSE 'desc' END;

    -- ========================================================================
    -- NON-NAME SORTING: Use path_tokens approach (unchanged)
    -- ========================================================================
    IF v_order_by != 'name' THEN
        RETURN QUERY EXECUTE format(
            $sql$
            WITH folders AS (
                SELECT path_tokens[$1] AS folder
                FROM storage.objects
                WHERE objects.name ILIKE $2 || '%%'
                  AND bucket_id = $3
                  AND array_length(objects.path_tokens, 1) <> $1
                GROUP BY folder
                ORDER BY folder %s
            )
            (SELECT folder AS "name",
                   NULL::uuid AS id,
                   NULL::timestamptz AS updated_at,
                   NULL::timestamptz AS created_at,
                   NULL::timestamptz AS last_accessed_at,
                   NULL::jsonb AS metadata FROM folders)
            UNION ALL
            (SELECT path_tokens[$1] AS "name",
                   id, updated_at, created_at, last_accessed_at, metadata
             FROM storage.objects
             WHERE objects.name ILIKE $2 || '%%'
               AND bucket_id = $3
               AND array_length(objects.path_tokens, 1) = $1
             ORDER BY %I %s)
            LIMIT $4 OFFSET $5
            $sql$, v_sort_order, v_order_by, v_sort_order
        ) USING levels, v_prefix, bucketname, v_limit, offsets;
        RETURN;
    END IF;

    -- ========================================================================
    -- NAME SORTING: Hybrid skip-scan with batch optimization
    -- ========================================================================

    -- Calculate upper bound for prefix filtering
    IF v_prefix_lower = '' THEN
        v_upper_bound := NULL;
    ELSIF right(v_prefix_lower, 1) = v_delimiter THEN
        v_upper_bound := left(v_prefix_lower, -1) || chr(ascii(v_delimiter) + 1);
    ELSE
        v_upper_bound := left(v_prefix_lower, -1) || chr(ascii(right(v_prefix_lower, 1)) + 1);
    END IF;

    -- Build batch query (dynamic SQL - called infrequently, amortized over many rows)
    IF v_is_asc THEN
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" >= $2 ' ||
                'AND lower(o.name) COLLATE "C" < $3 ORDER BY lower(o.name) COLLATE "C" ASC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" >= $2 ' ||
                'ORDER BY lower(o.name) COLLATE "C" ASC LIMIT $4';
        END IF;
    ELSE
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" < $2 ' ||
                'AND lower(o.name) COLLATE "C" >= $3 ORDER BY lower(o.name) COLLATE "C" DESC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" < $2 ' ||
                'ORDER BY lower(o.name) COLLATE "C" DESC LIMIT $4';
        END IF;
    END IF;

    -- Initialize seek position
    IF v_is_asc THEN
        v_next_seek := v_prefix_lower;
    ELSE
        -- DESC: find the last item in range first (static SQL)
        IF v_upper_bound IS NOT NULL THEN
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_prefix_lower AND lower(o.name) COLLATE "C" < v_upper_bound
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        ELSIF v_prefix_lower <> '' THEN
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_prefix_lower
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        ELSE
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        END IF;

        IF v_peek_name IS NOT NULL THEN
            v_next_seek := lower(v_peek_name) || v_delimiter;
        ELSE
            RETURN;
        END IF;
    END IF;

    -- ========================================================================
    -- MAIN LOOP: Hybrid peek-then-batch algorithm
    -- Uses STATIC SQL for peek (hot path) and DYNAMIC SQL for batch
    -- ========================================================================
    LOOP
        EXIT WHEN v_count >= v_limit;

        -- STEP 1: PEEK using STATIC SQL (plan cached, very fast)
        IF v_is_asc THEN
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_next_seek AND lower(o.name) COLLATE "C" < v_upper_bound
                ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_next_seek
                ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
            END IF;
        ELSE
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek AND lower(o.name) COLLATE "C" >= v_prefix_lower
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix_lower <> '' THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek AND lower(o.name) COLLATE "C" >= v_prefix_lower
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            END IF;
        END IF;

        EXIT WHEN v_peek_name IS NULL;

        -- STEP 2: Check if this is a FOLDER or FILE
        v_common_prefix := storage.get_common_prefix(lower(v_peek_name), v_prefix_lower, v_delimiter);

        IF v_common_prefix IS NOT NULL THEN
            -- FOLDER: Handle offset, emit if needed, skip to next folder
            IF v_skipped < offsets THEN
                v_skipped := v_skipped + 1;
            ELSE
                name := split_part(rtrim(storage.get_common_prefix(v_peek_name, v_prefix, v_delimiter), v_delimiter), v_delimiter, levels);
                id := NULL;
                updated_at := NULL;
                created_at := NULL;
                last_accessed_at := NULL;
                metadata := NULL;
                RETURN NEXT;
                v_count := v_count + 1;
            END IF;

            -- Advance seek past the folder range
            IF v_is_asc THEN
                v_next_seek := lower(left(v_common_prefix, -1)) || chr(ascii(v_delimiter) + 1);
            ELSE
                v_next_seek := lower(v_common_prefix);
            END IF;
        ELSE
            -- FILE: Batch fetch using DYNAMIC SQL (overhead amortized over many rows)
            -- For ASC: upper_bound is the exclusive upper limit (< condition)
            -- For DESC: prefix_lower is the inclusive lower limit (>= condition)
            FOR v_current IN EXECUTE v_batch_query
                USING bucketname, v_next_seek,
                    CASE WHEN v_is_asc THEN COALESCE(v_upper_bound, v_prefix_lower) ELSE v_prefix_lower END, v_file_batch_size
            LOOP
                v_common_prefix := storage.get_common_prefix(lower(v_current.name), v_prefix_lower, v_delimiter);

                IF v_common_prefix IS NOT NULL THEN
                    -- Hit a folder: exit batch, let peek handle it
                    v_next_seek := lower(v_current.name);
                    EXIT;
                END IF;

                -- Handle offset skipping
                IF v_skipped < offsets THEN
                    v_skipped := v_skipped + 1;
                ELSE
                    -- Emit file
                    name := split_part(v_current.name, v_delimiter, levels);
                    id := v_current.id;
                    updated_at := v_current.updated_at;
                    created_at := v_current.created_at;
                    last_accessed_at := v_current.last_accessed_at;
                    metadata := v_current.metadata;
                    RETURN NEXT;
                    v_count := v_count + 1;
                END IF;

                -- Advance seek past this file
                IF v_is_asc THEN
                    v_next_seek := lower(v_current.name) || v_delimiter;
                ELSE
                    v_next_seek := lower(v_current.name);
                END IF;

                EXIT WHEN v_count >= v_limit;
            END LOOP;
        END IF;
    END LOOP;
END;
$_$;


--
-- Name: search_by_timestamp("text", "text", integer, integer, "text", "text", "text", "text"); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION "storage"."search_by_timestamp"("p_prefix" "text", "p_bucket_id" "text", "p_limit" integer, "p_level" integer, "p_start_after" "text", "p_sort_order" "text", "p_sort_column" "text", "p_sort_column_after" "text") RETURNS TABLE("key" "text", "name" "text", "id" "uuid", "updated_at" timestamp with time zone, "created_at" timestamp with time zone, "last_accessed_at" timestamp with time zone, "metadata" "jsonb")
    LANGUAGE "plpgsql" STABLE
    AS $_$
DECLARE
    v_cursor_op text;
    v_query text;
    v_prefix text;
BEGIN
    v_prefix := coalesce(p_prefix, '');

    IF p_sort_order = 'asc' THEN
        v_cursor_op := '>';
    ELSE
        v_cursor_op := '<';
    END IF;

    v_query := format($sql$
        WITH raw_objects AS (
            SELECT
                o.name AS obj_name,
                o.id AS obj_id,
                o.updated_at AS obj_updated_at,
                o.created_at AS obj_created_at,
                o.last_accessed_at AS obj_last_accessed_at,
                o.metadata AS obj_metadata,
                storage.get_common_prefix(o.name, $1, '/') AS common_prefix
            FROM storage.objects o
            WHERE o.bucket_id = $2
              AND o.name COLLATE "C" LIKE $1 || '%%'
        ),
        -- Aggregate common prefixes (folders)
        -- Both created_at and updated_at use MIN(obj_created_at) to match the old prefixes table behavior
        aggregated_prefixes AS (
            SELECT
                rtrim(common_prefix, '/') AS name,
                NULL::uuid AS id,
                MIN(obj_created_at) AS updated_at,
                MIN(obj_created_at) AS created_at,
                NULL::timestamptz AS last_accessed_at,
                NULL::jsonb AS metadata,
                TRUE AS is_prefix
            FROM raw_objects
            WHERE common_prefix IS NOT NULL
            GROUP BY common_prefix
        ),
        leaf_objects AS (
            SELECT
                obj_name AS name,
                obj_id AS id,
                obj_updated_at AS updated_at,
                obj_created_at AS created_at,
                obj_last_accessed_at AS last_accessed_at,
                obj_metadata AS metadata,
                FALSE AS is_prefix
            FROM raw_objects
            WHERE common_prefix IS NULL
        ),
        combined AS (
            SELECT * FROM aggregated_prefixes
            UNION ALL
            SELECT * FROM leaf_objects
        ),
        filtered AS (
            SELECT *
            FROM combined
            WHERE (
                $5 = ''
                OR ROW(
                    date_trunc('milliseconds', %I),
                    name COLLATE "C"
                ) %s ROW(
                    COALESCE(NULLIF($6, '')::timestamptz, 'epoch'::timestamptz),
                    $5
                )
            )
        )
        SELECT
            split_part(name, '/', $3) AS key,
            name,
            id,
            updated_at,
            created_at,
            last_accessed_at,
            metadata
        FROM filtered
        ORDER BY
            COALESCE(date_trunc('milliseconds', %I), 'epoch'::timestamptz) %s,
            name COLLATE "C" %s
        LIMIT $4
    $sql$,
        p_sort_column,
        v_cursor_op,
        p_sort_column,
        p_sort_order,
        p_sort_order
    );

    RETURN QUERY EXECUTE v_query
    USING v_prefix, p_bucket_id, p_level, p_limit, p_start_after, p_sort_column_after;
END;
$_$;


--
-- Name: search_v2("text", "text", integer, integer, "text", "text", "text", "text"); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION "storage"."search_v2"("prefix" "text", "bucket_name" "text", "limits" integer DEFAULT 100, "levels" integer DEFAULT 1, "start_after" "text" DEFAULT ''::"text", "sort_order" "text" DEFAULT 'asc'::"text", "sort_column" "text" DEFAULT 'name'::"text", "sort_column_after" "text" DEFAULT ''::"text") RETURNS TABLE("key" "text", "name" "text", "id" "uuid", "updated_at" timestamp with time zone, "created_at" timestamp with time zone, "last_accessed_at" timestamp with time zone, "metadata" "jsonb")
    LANGUAGE "plpgsql" STABLE
    AS $$
DECLARE
    v_sort_col text;
    v_sort_ord text;
    v_limit int;
BEGIN
    -- Cap limit to maximum of 1500 records
    v_limit := LEAST(coalesce(limits, 100), 1500);

    -- Validate and normalize sort_order
    v_sort_ord := lower(coalesce(sort_order, 'asc'));
    IF v_sort_ord NOT IN ('asc', 'desc') THEN
        v_sort_ord := 'asc';
    END IF;

    -- Validate and normalize sort_column
    v_sort_col := lower(coalesce(sort_column, 'name'));
    IF v_sort_col NOT IN ('name', 'updated_at', 'created_at') THEN
        v_sort_col := 'name';
    END IF;

    -- Route to appropriate implementation
    IF v_sort_col = 'name' THEN
        -- Use list_objects_with_delimiter for name sorting (most efficient: O(k * log n))
        RETURN QUERY
        SELECT
            split_part(l.name, '/', levels) AS key,
            l.name AS name,
            l.id,
            l.updated_at,
            l.created_at,
            l.last_accessed_at,
            l.metadata
        FROM storage.list_objects_with_delimiter(
            bucket_name,
            coalesce(prefix, ''),
            '/',
            v_limit,
            start_after,
            '',
            v_sort_ord
        ) l;
    ELSE
        -- Use aggregation approach for timestamp sorting
        -- Not efficient for large datasets but supports correct pagination
        RETURN QUERY SELECT * FROM storage.search_by_timestamp(
            prefix, bucket_name, v_limit, levels, start_after,
            v_sort_ord, v_sort_col, sort_column_after
        );
    END IF;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION "storage"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW; 
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = "heap";

--
-- Name: audit_log_entries; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE "auth"."audit_log_entries" (
    "instance_id" "uuid",
    "id" "uuid" NOT NULL,
    "payload" json,
    "created_at" timestamp with time zone,
    "ip_address" character varying(64) DEFAULT ''::character varying NOT NULL
);


--
-- Name: TABLE "audit_log_entries"; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE "auth"."audit_log_entries" IS 'Auth: Audit trail for user actions.';


--
-- Name: custom_oauth_providers; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE "auth"."custom_oauth_providers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider_type" "text" NOT NULL,
    "identifier" "text" NOT NULL,
    "name" "text" NOT NULL,
    "client_id" "text" NOT NULL,
    "client_secret" "text" NOT NULL,
    "acceptable_client_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "scopes" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "pkce_enabled" boolean DEFAULT true NOT NULL,
    "attribute_mapping" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "authorization_params" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "email_optional" boolean DEFAULT false NOT NULL,
    "issuer" "text",
    "discovery_url" "text",
    "skip_nonce_check" boolean DEFAULT false NOT NULL,
    "cached_discovery" "jsonb",
    "discovery_cached_at" timestamp with time zone,
    "authorization_url" "text",
    "token_url" "text",
    "userinfo_url" "text",
    "jwks_uri" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "custom_oauth_providers_authorization_url_https" CHECK ((("authorization_url" IS NULL) OR ("authorization_url" ~~ 'https://%'::"text"))),
    CONSTRAINT "custom_oauth_providers_authorization_url_length" CHECK ((("authorization_url" IS NULL) OR ("char_length"("authorization_url") <= 2048))),
    CONSTRAINT "custom_oauth_providers_client_id_length" CHECK ((("char_length"("client_id") >= 1) AND ("char_length"("client_id") <= 512))),
    CONSTRAINT "custom_oauth_providers_discovery_url_length" CHECK ((("discovery_url" IS NULL) OR ("char_length"("discovery_url") <= 2048))),
    CONSTRAINT "custom_oauth_providers_identifier_format" CHECK (("identifier" ~ '^[a-z0-9][a-z0-9:-]{0,48}[a-z0-9]$'::"text")),
    CONSTRAINT "custom_oauth_providers_issuer_length" CHECK ((("issuer" IS NULL) OR (("char_length"("issuer") >= 1) AND ("char_length"("issuer") <= 2048)))),
    CONSTRAINT "custom_oauth_providers_jwks_uri_https" CHECK ((("jwks_uri" IS NULL) OR ("jwks_uri" ~~ 'https://%'::"text"))),
    CONSTRAINT "custom_oauth_providers_jwks_uri_length" CHECK ((("jwks_uri" IS NULL) OR ("char_length"("jwks_uri") <= 2048))),
    CONSTRAINT "custom_oauth_providers_name_length" CHECK ((("char_length"("name") >= 1) AND ("char_length"("name") <= 100))),
    CONSTRAINT "custom_oauth_providers_oauth2_requires_endpoints" CHECK ((("provider_type" <> 'oauth2'::"text") OR (("authorization_url" IS NOT NULL) AND ("token_url" IS NOT NULL) AND ("userinfo_url" IS NOT NULL)))),
    CONSTRAINT "custom_oauth_providers_oidc_discovery_url_https" CHECK ((("provider_type" <> 'oidc'::"text") OR ("discovery_url" IS NULL) OR ("discovery_url" ~~ 'https://%'::"text"))),
    CONSTRAINT "custom_oauth_providers_oidc_issuer_https" CHECK ((("provider_type" <> 'oidc'::"text") OR ("issuer" IS NULL) OR ("issuer" ~~ 'https://%'::"text"))),
    CONSTRAINT "custom_oauth_providers_oidc_requires_issuer" CHECK ((("provider_type" <> 'oidc'::"text") OR ("issuer" IS NOT NULL))),
    CONSTRAINT "custom_oauth_providers_provider_type_check" CHECK (("provider_type" = ANY (ARRAY['oauth2'::"text", 'oidc'::"text"]))),
    CONSTRAINT "custom_oauth_providers_token_url_https" CHECK ((("token_url" IS NULL) OR ("token_url" ~~ 'https://%'::"text"))),
    CONSTRAINT "custom_oauth_providers_token_url_length" CHECK ((("token_url" IS NULL) OR ("char_length"("token_url") <= 2048))),
    CONSTRAINT "custom_oauth_providers_userinfo_url_https" CHECK ((("userinfo_url" IS NULL) OR ("userinfo_url" ~~ 'https://%'::"text"))),
    CONSTRAINT "custom_oauth_providers_userinfo_url_length" CHECK ((("userinfo_url" IS NULL) OR ("char_length"("userinfo_url") <= 2048)))
);


--
-- Name: flow_state; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE "auth"."flow_state" (
    "id" "uuid" NOT NULL,
    "user_id" "uuid",
    "auth_code" "text",
    "code_challenge_method" "auth"."code_challenge_method",
    "code_challenge" "text",
    "provider_type" "text" NOT NULL,
    "provider_access_token" "text",
    "provider_refresh_token" "text",
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "authentication_method" "text" NOT NULL,
    "auth_code_issued_at" timestamp with time zone,
    "invite_token" "text",
    "referrer" "text",
    "oauth_client_state_id" "uuid",
    "linking_target_id" "uuid",
    "email_optional" boolean DEFAULT false NOT NULL
);


--
-- Name: TABLE "flow_state"; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE "auth"."flow_state" IS 'Stores metadata for all OAuth/SSO login flows';


--
-- Name: identities; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE "auth"."identities" (
    "provider_id" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "identity_data" "jsonb" NOT NULL,
    "provider" "text" NOT NULL,
    "last_sign_in_at" timestamp with time zone,
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "email" "text" GENERATED ALWAYS AS ("lower"(("identity_data" ->> 'email'::"text"))) STORED,
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL
);


--
-- Name: TABLE "identities"; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE "auth"."identities" IS 'Auth: Stores identities associated to a user.';


--
-- Name: COLUMN "identities"."email"; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN "auth"."identities"."email" IS 'Auth: Email is a generated column that references the optional email property in the identity_data';


--
-- Name: instances; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE "auth"."instances" (
    "id" "uuid" NOT NULL,
    "uuid" "uuid",
    "raw_base_config" "text",
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone
);


--
-- Name: TABLE "instances"; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE "auth"."instances" IS 'Auth: Manages users across multiple sites.';


--
-- Name: mfa_amr_claims; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE "auth"."mfa_amr_claims" (
    "session_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    "authentication_method" "text" NOT NULL,
    "id" "uuid" NOT NULL
);


--
-- Name: TABLE "mfa_amr_claims"; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE "auth"."mfa_amr_claims" IS 'auth: stores authenticator method reference claims for multi factor authentication';


--
-- Name: mfa_challenges; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE "auth"."mfa_challenges" (
    "id" "uuid" NOT NULL,
    "factor_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone NOT NULL,
    "verified_at" timestamp with time zone,
    "ip_address" "inet" NOT NULL,
    "otp_code" "text",
    "web_authn_session_data" "jsonb"
);


--
-- Name: TABLE "mfa_challenges"; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE "auth"."mfa_challenges" IS 'auth: stores metadata about challenge requests made';


--
-- Name: mfa_factors; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE "auth"."mfa_factors" (
    "id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "friendly_name" "text",
    "factor_type" "auth"."factor_type" NOT NULL,
    "status" "auth"."factor_status" NOT NULL,
    "created_at" timestamp with time zone NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    "secret" "text",
    "phone" "text",
    "last_challenged_at" timestamp with time zone,
    "web_authn_credential" "jsonb",
    "web_authn_aaguid" "uuid",
    "last_webauthn_challenge_data" "jsonb"
);


--
-- Name: TABLE "mfa_factors"; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE "auth"."mfa_factors" IS 'auth: stores metadata about factors';


--
-- Name: COLUMN "mfa_factors"."last_webauthn_challenge_data"; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN "auth"."mfa_factors"."last_webauthn_challenge_data" IS 'Stores the latest WebAuthn challenge data including attestation/assertion for customer verification';


--
-- Name: oauth_authorizations; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE "auth"."oauth_authorizations" (
    "id" "uuid" NOT NULL,
    "authorization_id" "text" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "redirect_uri" "text" NOT NULL,
    "scope" "text" NOT NULL,
    "state" "text",
    "resource" "text",
    "code_challenge" "text",
    "code_challenge_method" "auth"."code_challenge_method",
    "response_type" "auth"."oauth_response_type" DEFAULT 'code'::"auth"."oauth_response_type" NOT NULL,
    "status" "auth"."oauth_authorization_status" DEFAULT 'pending'::"auth"."oauth_authorization_status" NOT NULL,
    "authorization_code" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '00:03:00'::interval) NOT NULL,
    "approved_at" timestamp with time zone,
    "nonce" "text",
    CONSTRAINT "oauth_authorizations_authorization_code_length" CHECK (("char_length"("authorization_code") <= 255)),
    CONSTRAINT "oauth_authorizations_code_challenge_length" CHECK (("char_length"("code_challenge") <= 128)),
    CONSTRAINT "oauth_authorizations_expires_at_future" CHECK (("expires_at" > "created_at")),
    CONSTRAINT "oauth_authorizations_nonce_length" CHECK (("char_length"("nonce") <= 255)),
    CONSTRAINT "oauth_authorizations_redirect_uri_length" CHECK (("char_length"("redirect_uri") <= 2048)),
    CONSTRAINT "oauth_authorizations_resource_length" CHECK (("char_length"("resource") <= 2048)),
    CONSTRAINT "oauth_authorizations_scope_length" CHECK (("char_length"("scope") <= 4096)),
    CONSTRAINT "oauth_authorizations_state_length" CHECK (("char_length"("state") <= 4096))
);


--
-- Name: oauth_client_states; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE "auth"."oauth_client_states" (
    "id" "uuid" NOT NULL,
    "provider_type" "text" NOT NULL,
    "code_verifier" "text",
    "created_at" timestamp with time zone NOT NULL
);


--
-- Name: TABLE "oauth_client_states"; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE "auth"."oauth_client_states" IS 'Stores OAuth states for third-party provider authentication flows where Supabase acts as the OAuth client.';


--
-- Name: oauth_clients; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE "auth"."oauth_clients" (
    "id" "uuid" NOT NULL,
    "client_secret_hash" "text",
    "registration_type" "auth"."oauth_registration_type" NOT NULL,
    "redirect_uris" "text" NOT NULL,
    "grant_types" "text" NOT NULL,
    "client_name" "text",
    "client_uri" "text",
    "logo_uri" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "client_type" "auth"."oauth_client_type" DEFAULT 'confidential'::"auth"."oauth_client_type" NOT NULL,
    "token_endpoint_auth_method" "text" NOT NULL,
    CONSTRAINT "oauth_clients_client_name_length" CHECK (("char_length"("client_name") <= 1024)),
    CONSTRAINT "oauth_clients_client_uri_length" CHECK (("char_length"("client_uri") <= 2048)),
    CONSTRAINT "oauth_clients_logo_uri_length" CHECK (("char_length"("logo_uri") <= 2048)),
    CONSTRAINT "oauth_clients_token_endpoint_auth_method_check" CHECK (("token_endpoint_auth_method" = ANY (ARRAY['client_secret_basic'::"text", 'client_secret_post'::"text", 'none'::"text"])))
);


--
-- Name: oauth_consents; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE "auth"."oauth_consents" (
    "id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "scopes" "text" NOT NULL,
    "granted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "revoked_at" timestamp with time zone,
    CONSTRAINT "oauth_consents_revoked_after_granted" CHECK ((("revoked_at" IS NULL) OR ("revoked_at" >= "granted_at"))),
    CONSTRAINT "oauth_consents_scopes_length" CHECK (("char_length"("scopes") <= 2048)),
    CONSTRAINT "oauth_consents_scopes_not_empty" CHECK (("char_length"(TRIM(BOTH FROM "scopes")) > 0))
);


--
-- Name: one_time_tokens; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE "auth"."one_time_tokens" (
    "id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "token_type" "auth"."one_time_token_type" NOT NULL,
    "token_hash" "text" NOT NULL,
    "relates_to" "text" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "one_time_tokens_token_hash_check" CHECK (("char_length"("token_hash") > 0))
);


--
-- Name: refresh_tokens; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE "auth"."refresh_tokens" (
    "instance_id" "uuid",
    "id" bigint NOT NULL,
    "token" character varying(255),
    "user_id" character varying(255),
    "revoked" boolean,
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "parent" character varying(255),
    "session_id" "uuid"
);


--
-- Name: TABLE "refresh_tokens"; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE "auth"."refresh_tokens" IS 'Auth: Store of tokens used to refresh JWT tokens once they expire.';


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE; Schema: auth; Owner: -
--

CREATE SEQUENCE "auth"."refresh_tokens_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: auth; Owner: -
--

ALTER SEQUENCE "auth"."refresh_tokens_id_seq" OWNED BY "auth"."refresh_tokens"."id";


--
-- Name: saml_providers; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE "auth"."saml_providers" (
    "id" "uuid" NOT NULL,
    "sso_provider_id" "uuid" NOT NULL,
    "entity_id" "text" NOT NULL,
    "metadata_xml" "text" NOT NULL,
    "metadata_url" "text",
    "attribute_mapping" "jsonb",
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "name_id_format" "text",
    CONSTRAINT "entity_id not empty" CHECK (("char_length"("entity_id") > 0)),
    CONSTRAINT "metadata_url not empty" CHECK ((("metadata_url" = NULL::"text") OR ("char_length"("metadata_url") > 0))),
    CONSTRAINT "metadata_xml not empty" CHECK (("char_length"("metadata_xml") > 0))
);


--
-- Name: TABLE "saml_providers"; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE "auth"."saml_providers" IS 'Auth: Manages SAML Identity Provider connections.';


--
-- Name: saml_relay_states; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE "auth"."saml_relay_states" (
    "id" "uuid" NOT NULL,
    "sso_provider_id" "uuid" NOT NULL,
    "request_id" "text" NOT NULL,
    "for_email" "text",
    "redirect_to" "text",
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "flow_state_id" "uuid",
    CONSTRAINT "request_id not empty" CHECK (("char_length"("request_id") > 0))
);


--
-- Name: TABLE "saml_relay_states"; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE "auth"."saml_relay_states" IS 'Auth: Contains SAML Relay State information for each Service Provider initiated login.';


--
-- Name: schema_migrations; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE "auth"."schema_migrations" (
    "version" character varying(255) NOT NULL
);


--
-- Name: TABLE "schema_migrations"; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE "auth"."schema_migrations" IS 'Auth: Manages updates to the auth system.';


--
-- Name: sessions; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE "auth"."sessions" (
    "id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "factor_id" "uuid",
    "aal" "auth"."aal_level",
    "not_after" timestamp with time zone,
    "refreshed_at" timestamp without time zone,
    "user_agent" "text",
    "ip" "inet",
    "tag" "text",
    "oauth_client_id" "uuid",
    "refresh_token_hmac_key" "text",
    "refresh_token_counter" bigint,
    "scopes" "text",
    CONSTRAINT "sessions_scopes_length" CHECK (("char_length"("scopes") <= 4096))
);


--
-- Name: TABLE "sessions"; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE "auth"."sessions" IS 'Auth: Stores session data associated to a user.';


--
-- Name: COLUMN "sessions"."not_after"; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN "auth"."sessions"."not_after" IS 'Auth: Not after is a nullable column that contains a timestamp after which the session should be regarded as expired.';


--
-- Name: COLUMN "sessions"."refresh_token_hmac_key"; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN "auth"."sessions"."refresh_token_hmac_key" IS 'Holds a HMAC-SHA256 key used to sign refresh tokens for this session.';


--
-- Name: COLUMN "sessions"."refresh_token_counter"; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN "auth"."sessions"."refresh_token_counter" IS 'Holds the ID (counter) of the last issued refresh token.';


--
-- Name: sso_domains; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE "auth"."sso_domains" (
    "id" "uuid" NOT NULL,
    "sso_provider_id" "uuid" NOT NULL,
    "domain" "text" NOT NULL,
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    CONSTRAINT "domain not empty" CHECK (("char_length"("domain") > 0))
);


--
-- Name: TABLE "sso_domains"; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE "auth"."sso_domains" IS 'Auth: Manages SSO email address domain mapping to an SSO Identity Provider.';


--
-- Name: sso_providers; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE "auth"."sso_providers" (
    "id" "uuid" NOT NULL,
    "resource_id" "text",
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "disabled" boolean,
    CONSTRAINT "resource_id not empty" CHECK ((("resource_id" = NULL::"text") OR ("char_length"("resource_id") > 0)))
);


--
-- Name: TABLE "sso_providers"; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE "auth"."sso_providers" IS 'Auth: Manages SSO identity provider information; see saml_providers for SAML.';


--
-- Name: COLUMN "sso_providers"."resource_id"; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN "auth"."sso_providers"."resource_id" IS 'Auth: Uniquely identifies a SSO provider according to a user-chosen resource ID (case insensitive), useful in infrastructure as code.';


--
-- Name: users; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE "auth"."users" (
    "instance_id" "uuid",
    "id" "uuid" NOT NULL,
    "aud" character varying(255),
    "role" character varying(255),
    "email" character varying(255),
    "encrypted_password" character varying(255),
    "email_confirmed_at" timestamp with time zone,
    "invited_at" timestamp with time zone,
    "confirmation_token" character varying(255),
    "confirmation_sent_at" timestamp with time zone,
    "recovery_token" character varying(255),
    "recovery_sent_at" timestamp with time zone,
    "email_change_token_new" character varying(255),
    "email_change" character varying(255),
    "email_change_sent_at" timestamp with time zone,
    "last_sign_in_at" timestamp with time zone,
    "raw_app_meta_data" "jsonb",
    "raw_user_meta_data" "jsonb",
    "is_super_admin" boolean,
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "phone" "text" DEFAULT NULL::character varying,
    "phone_confirmed_at" timestamp with time zone,
    "phone_change" "text" DEFAULT ''::character varying,
    "phone_change_token" character varying(255) DEFAULT ''::character varying,
    "phone_change_sent_at" timestamp with time zone,
    "confirmed_at" timestamp with time zone GENERATED ALWAYS AS (LEAST("email_confirmed_at", "phone_confirmed_at")) STORED,
    "email_change_token_current" character varying(255) DEFAULT ''::character varying,
    "email_change_confirm_status" smallint DEFAULT 0,
    "banned_until" timestamp with time zone,
    "reauthentication_token" character varying(255) DEFAULT ''::character varying,
    "reauthentication_sent_at" timestamp with time zone,
    "is_sso_user" boolean DEFAULT false NOT NULL,
    "deleted_at" timestamp with time zone,
    "is_anonymous" boolean DEFAULT false NOT NULL,
    CONSTRAINT "users_email_change_confirm_status_check" CHECK ((("email_change_confirm_status" >= 0) AND ("email_change_confirm_status" <= 2)))
);


--
-- Name: TABLE "users"; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE "auth"."users" IS 'Auth: Stores user login data within a secure schema.';


--
-- Name: COLUMN "users"."is_sso_user"; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN "auth"."users"."is_sso_user" IS 'Auth: Set this column to true when the account comes from SSO. These accounts can have duplicate emails.';


--
-- Name: webauthn_challenges; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE "auth"."webauthn_challenges" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "challenge_type" "text" NOT NULL,
    "session_data" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    CONSTRAINT "webauthn_challenges_challenge_type_check" CHECK (("challenge_type" = ANY (ARRAY['signup'::"text", 'registration'::"text", 'authentication'::"text"])))
);


--
-- Name: webauthn_credentials; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE "auth"."webauthn_credentials" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "credential_id" "bytea" NOT NULL,
    "public_key" "bytea" NOT NULL,
    "attestation_type" "text" DEFAULT ''::"text" NOT NULL,
    "aaguid" "uuid",
    "sign_count" bigint DEFAULT 0 NOT NULL,
    "transports" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "backup_eligible" boolean DEFAULT false NOT NULL,
    "backed_up" boolean DEFAULT false NOT NULL,
    "friendly_name" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_used_at" timestamp with time zone
);


--
-- Name: compound; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."compound" (
    "id" integer NOT NULL,
    "job_id" integer NOT NULL,
    "name" character varying,
    "smiles" character varying NOT NULL
);


--
-- Name: compound_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."compound_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: compound_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."compound_id_seq" OWNED BY "public"."compound"."id";


--
-- Name: dockingresult; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."dockingresult" (
    "id" integer NOT NULL,
    "job_id" integer NOT NULL,
    "compound_id" integer NOT NULL,
    "variant" character varying NOT NULL,
    "best_score" double precision NOT NULL,
    "pose_uri" character varying,
    "extra" character varying,
    "created_at" timestamp without time zone NOT NULL
);


--
-- Name: dockingresult_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."dockingresult_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dockingresult_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."dockingresult_id_seq" OWNED BY "public"."dockingresult"."id";


--
-- Name: job; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."job" (
    "id" integer NOT NULL,
    "share_id" character varying(32) NOT NULL,
    "created_at" timestamp without time zone NOT NULL,
    "updated_at" timestamp without time zone NOT NULL,
    "uniprot_id" character varying,
    "pdb_id" character varying NOT NULL,
    "chain" character varying NOT NULL,
    "mutations" character varying NOT NULL,
    "exhaustiveness" integer NOT NULL,
    "include_wt" boolean NOT NULL,
    "status" "public"."jobstatus" NOT NULL,
    "error_message" character varying,
    "user_id" integer
);


--
-- Name: job_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."job_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: job_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."job_id_seq" OWNED BY "public"."job"."id";


--
-- Name: messages; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE "realtime"."messages" (
    "topic" "text" NOT NULL,
    "extension" "text" NOT NULL,
    "payload" "jsonb",
    "event" "text",
    "private" boolean DEFAULT false,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "inserted_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL
)
PARTITION BY RANGE ("inserted_at");


--
-- Name: schema_migrations; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE "realtime"."schema_migrations" (
    "version" bigint NOT NULL,
    "inserted_at" timestamp(0) without time zone
);


--
-- Name: subscription; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE "realtime"."subscription" (
    "id" bigint NOT NULL,
    "subscription_id" "uuid" NOT NULL,
    "entity" "regclass" NOT NULL,
    "filters" "realtime"."user_defined_filter"[] DEFAULT '{}'::"realtime"."user_defined_filter"[] NOT NULL,
    "claims" "jsonb" NOT NULL,
    "claims_role" "regrole" GENERATED ALWAYS AS ("realtime"."to_regrole"(("claims" ->> 'role'::"text"))) STORED NOT NULL,
    "created_at" timestamp without time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "action_filter" "text" DEFAULT '*'::"text",
    CONSTRAINT "subscription_action_filter_check" CHECK (("action_filter" = ANY (ARRAY['*'::"text", 'INSERT'::"text", 'UPDATE'::"text", 'DELETE'::"text"])))
);


--
-- Name: subscription_id_seq; Type: SEQUENCE; Schema: realtime; Owner: -
--

ALTER TABLE "realtime"."subscription" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "realtime"."subscription_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: buckets; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE "storage"."buckets" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "owner" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "public" boolean DEFAULT false,
    "avif_autodetection" boolean DEFAULT false,
    "file_size_limit" bigint,
    "allowed_mime_types" "text"[],
    "owner_id" "text",
    "type" "storage"."buckettype" DEFAULT 'STANDARD'::"storage"."buckettype" NOT NULL
);


--
-- Name: COLUMN "buckets"."owner"; Type: COMMENT; Schema: storage; Owner: -
--

COMMENT ON COLUMN "storage"."buckets"."owner" IS 'Field is deprecated, use owner_id instead';


--
-- Name: buckets_analytics; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE "storage"."buckets_analytics" (
    "name" "text" NOT NULL,
    "type" "storage"."buckettype" DEFAULT 'ANALYTICS'::"storage"."buckettype" NOT NULL,
    "format" "text" DEFAULT 'ICEBERG'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "deleted_at" timestamp with time zone
);


--
-- Name: buckets_vectors; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE "storage"."buckets_vectors" (
    "id" "text" NOT NULL,
    "type" "storage"."buckettype" DEFAULT 'VECTOR'::"storage"."buckettype" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: migrations; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE "storage"."migrations" (
    "id" integer NOT NULL,
    "name" character varying(100) NOT NULL,
    "hash" character varying(40) NOT NULL,
    "executed_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: objects; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE "storage"."objects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bucket_id" "text",
    "name" "text",
    "owner" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "last_accessed_at" timestamp with time zone DEFAULT "now"(),
    "metadata" "jsonb",
    "path_tokens" "text"[] GENERATED ALWAYS AS ("string_to_array"("name", '/'::"text")) STORED,
    "version" "text",
    "owner_id" "text",
    "user_metadata" "jsonb"
);


--
-- Name: COLUMN "objects"."owner"; Type: COMMENT; Schema: storage; Owner: -
--

COMMENT ON COLUMN "storage"."objects"."owner" IS 'Field is deprecated, use owner_id instead';


--
-- Name: s3_multipart_uploads; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE "storage"."s3_multipart_uploads" (
    "id" "text" NOT NULL,
    "in_progress_size" bigint DEFAULT 0 NOT NULL,
    "upload_signature" "text" NOT NULL,
    "bucket_id" "text" NOT NULL,
    "key" "text" NOT NULL COLLATE "pg_catalog"."C",
    "version" "text" NOT NULL,
    "owner_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_metadata" "jsonb",
    "metadata" "jsonb"
);


--
-- Name: s3_multipart_uploads_parts; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE "storage"."s3_multipart_uploads_parts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "upload_id" "text" NOT NULL,
    "size" bigint DEFAULT 0 NOT NULL,
    "part_number" integer NOT NULL,
    "bucket_id" "text" NOT NULL,
    "key" "text" NOT NULL COLLATE "pg_catalog"."C",
    "etag" "text" NOT NULL,
    "owner_id" "text",
    "version" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: vector_indexes; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE "storage"."vector_indexes" (
    "id" "text" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL COLLATE "pg_catalog"."C",
    "bucket_id" "text" NOT NULL,
    "data_type" "text" NOT NULL,
    "dimension" integer NOT NULL,
    "distance_metric" "text" NOT NULL,
    "metadata_configuration" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: refresh_tokens id; Type: DEFAULT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."refresh_tokens" ALTER COLUMN "id" SET DEFAULT "nextval"('"auth"."refresh_tokens_id_seq"'::"regclass");


--
-- Name: compound id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."compound" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."compound_id_seq"'::"regclass");


--
-- Name: dockingresult id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."dockingresult" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."dockingresult_id_seq"'::"regclass");


--
-- Name: job id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."job" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."job_id_seq"'::"regclass");


--
-- Data for Name: audit_log_entries; Type: TABLE DATA; Schema: auth; Owner: -
--

COPY "auth"."audit_log_entries" ("instance_id", "id", "payload", "created_at", "ip_address") FROM stdin;
\.


--
-- Data for Name: custom_oauth_providers; Type: TABLE DATA; Schema: auth; Owner: -
--

COPY "auth"."custom_oauth_providers" ("id", "provider_type", "identifier", "name", "client_id", "client_secret", "acceptable_client_ids", "scopes", "pkce_enabled", "attribute_mapping", "authorization_params", "enabled", "email_optional", "issuer", "discovery_url", "skip_nonce_check", "cached_discovery", "discovery_cached_at", "authorization_url", "token_url", "userinfo_url", "jwks_uri", "created_at", "updated_at") FROM stdin;
\.


--
-- Data for Name: flow_state; Type: TABLE DATA; Schema: auth; Owner: -
--

COPY "auth"."flow_state" ("id", "user_id", "auth_code", "code_challenge_method", "code_challenge", "provider_type", "provider_access_token", "provider_refresh_token", "created_at", "updated_at", "authentication_method", "auth_code_issued_at", "invite_token", "referrer", "oauth_client_state_id", "linking_target_id", "email_optional") FROM stdin;
\.


--
-- Data for Name: identities; Type: TABLE DATA; Schema: auth; Owner: -
--

COPY "auth"."identities" ("provider_id", "user_id", "identity_data", "provider", "last_sign_in_at", "created_at", "updated_at", "id") FROM stdin;
\.


--
-- Data for Name: instances; Type: TABLE DATA; Schema: auth; Owner: -
--

COPY "auth"."instances" ("id", "uuid", "raw_base_config", "created_at", "updated_at") FROM stdin;
\.


--
-- Data for Name: mfa_amr_claims; Type: TABLE DATA; Schema: auth; Owner: -
--

COPY "auth"."mfa_amr_claims" ("session_id", "created_at", "updated_at", "authentication_method", "id") FROM stdin;
\.


--
-- Data for Name: mfa_challenges; Type: TABLE DATA; Schema: auth; Owner: -
--

COPY "auth"."mfa_challenges" ("id", "factor_id", "created_at", "verified_at", "ip_address", "otp_code", "web_authn_session_data") FROM stdin;
\.


--
-- Data for Name: mfa_factors; Type: TABLE DATA; Schema: auth; Owner: -
--

COPY "auth"."mfa_factors" ("id", "user_id", "friendly_name", "factor_type", "status", "created_at", "updated_at", "secret", "phone", "last_challenged_at", "web_authn_credential", "web_authn_aaguid", "last_webauthn_challenge_data") FROM stdin;
\.


--
-- Data for Name: oauth_authorizations; Type: TABLE DATA; Schema: auth; Owner: -
--

COPY "auth"."oauth_authorizations" ("id", "authorization_id", "client_id", "user_id", "redirect_uri", "scope", "state", "resource", "code_challenge", "code_challenge_method", "response_type", "status", "authorization_code", "created_at", "expires_at", "approved_at", "nonce") FROM stdin;
\.


--
-- Data for Name: oauth_client_states; Type: TABLE DATA; Schema: auth; Owner: -
--

COPY "auth"."oauth_client_states" ("id", "provider_type", "code_verifier", "created_at") FROM stdin;
\.


--
-- Data for Name: oauth_clients; Type: TABLE DATA; Schema: auth; Owner: -
--

COPY "auth"."oauth_clients" ("id", "client_secret_hash", "registration_type", "redirect_uris", "grant_types", "client_name", "client_uri", "logo_uri", "created_at", "updated_at", "deleted_at", "client_type", "token_endpoint_auth_method") FROM stdin;
\.


--
-- Data for Name: oauth_consents; Type: TABLE DATA; Schema: auth; Owner: -
--

COPY "auth"."oauth_consents" ("id", "user_id", "client_id", "scopes", "granted_at", "revoked_at") FROM stdin;
\.


--
-- Data for Name: one_time_tokens; Type: TABLE DATA; Schema: auth; Owner: -
--

COPY "auth"."one_time_tokens" ("id", "user_id", "token_type", "token_hash", "relates_to", "created_at", "updated_at") FROM stdin;
\.


--
-- Data for Name: refresh_tokens; Type: TABLE DATA; Schema: auth; Owner: -
--

COPY "auth"."refresh_tokens" ("instance_id", "id", "token", "user_id", "revoked", "created_at", "updated_at", "parent", "session_id") FROM stdin;
\.


--
-- Data for Name: saml_providers; Type: TABLE DATA; Schema: auth; Owner: -
--

COPY "auth"."saml_providers" ("id", "sso_provider_id", "entity_id", "metadata_xml", "metadata_url", "attribute_mapping", "created_at", "updated_at", "name_id_format") FROM stdin;
\.


--
-- Data for Name: saml_relay_states; Type: TABLE DATA; Schema: auth; Owner: -
--

COPY "auth"."saml_relay_states" ("id", "sso_provider_id", "request_id", "for_email", "redirect_to", "created_at", "updated_at", "flow_state_id") FROM stdin;
\.


--
-- Data for Name: schema_migrations; Type: TABLE DATA; Schema: auth; Owner: -
--

COPY "auth"."schema_migrations" ("version") FROM stdin;
20171026211738
20171026211808
20171026211834
20180103212743
20180108183307
20180119214651
20180125194653
00
20210710035447
20210722035447
20210730183235
20210909172000
20210927181326
20211122151130
20211124214934
20211202183645
20220114185221
20220114185340
20220224000811
20220323170000
20220429102000
20220531120530
20220614074223
20220811173540
20221003041349
20221003041400
20221011041400
20221020193600
20221021073300
20221021082433
20221027105023
20221114143122
20221114143410
20221125140132
20221208132122
20221215195500
20221215195800
20221215195900
20230116124310
20230116124412
20230131181311
20230322519590
20230402418590
20230411005111
20230508135423
20230523124323
20230818113222
20230914180801
20231027141322
20231114161723
20231117164230
20240115144230
20240214120130
20240306115329
20240314092811
20240427152123
20240612123726
20240729123726
20240802193726
20240806073726
20241009103726
20250717082212
20250731150234
20250804100000
20250901200500
20250903112500
20250904133000
20250925093508
20251007112900
20251104100000
20251111201300
20251201000000
20260115000000
20260121000000
20260219120000
20260302000000
\.


--
-- Data for Name: sessions; Type: TABLE DATA; Schema: auth; Owner: -
--

COPY "auth"."sessions" ("id", "user_id", "created_at", "updated_at", "factor_id", "aal", "not_after", "refreshed_at", "user_agent", "ip", "tag", "oauth_client_id", "refresh_token_hmac_key", "refresh_token_counter", "scopes") FROM stdin;
\.


--
-- Data for Name: sso_domains; Type: TABLE DATA; Schema: auth; Owner: -
--

COPY "auth"."sso_domains" ("id", "sso_provider_id", "domain", "created_at", "updated_at") FROM stdin;
\.


--
-- Data for Name: sso_providers; Type: TABLE DATA; Schema: auth; Owner: -
--

COPY "auth"."sso_providers" ("id", "resource_id", "created_at", "updated_at", "disabled") FROM stdin;
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: auth; Owner: -
--

COPY "auth"."users" ("instance_id", "id", "aud", "role", "email", "encrypted_password", "email_confirmed_at", "invited_at", "confirmation_token", "confirmation_sent_at", "recovery_token", "recovery_sent_at", "email_change_token_new", "email_change", "email_change_sent_at", "last_sign_in_at", "raw_app_meta_data", "raw_user_meta_data", "is_super_admin", "created_at", "updated_at", "phone", "phone_confirmed_at", "phone_change", "phone_change_token", "phone_change_sent_at", "email_change_token_current", "email_change_confirm_status", "banned_until", "reauthentication_token", "reauthentication_sent_at", "is_sso_user", "deleted_at", "is_anonymous") FROM stdin;
\.


--
-- Data for Name: webauthn_challenges; Type: TABLE DATA; Schema: auth; Owner: -
--

COPY "auth"."webauthn_challenges" ("id", "user_id", "challenge_type", "session_data", "created_at", "expires_at") FROM stdin;
\.


--
-- Data for Name: webauthn_credentials; Type: TABLE DATA; Schema: auth; Owner: -
--

COPY "auth"."webauthn_credentials" ("id", "user_id", "credential_id", "public_key", "attestation_type", "aaguid", "sign_count", "transports", "backup_eligible", "backed_up", "friendly_name", "created_at", "updated_at", "last_used_at") FROM stdin;
\.


--
-- Data for Name: compound; Type: TABLE DATA; Schema: public; Owner: -
--

COPY "public"."compound" ("id", "job_id", "name", "smiles") FROM stdin;
1	1	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
2	7	gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
3	8	gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
4	9	gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
5	10	gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
6	10	osimertinib	COc1cc(N(C)CCN(C)C)c(NC(=O)C=C)cc1Nc1nccc(-c2cn(C)c3ccccc23)n1
7	11	invalid	not-a-real-smiles!!!
8	15	Erlotinib	COCCOc1cc2ncnc(Nc3cccc(C#C)c3)c2cc1OCCOC
9	16	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
10	17	curcumin	COC1=C(C=CC(=C1)/C=C/C(=O)CC(=O)/C=C/C2=CC(=C(C=C2)O)OC)O
11	18	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
12	19	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
13	20	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
14	21	Aspirin	CC(=O)OC1=CC=CC=C1C(=O)O
15	22	Aspirin	CC(=O)OC1=CC=CC=C1C(=O)O
16	23	Aspirin	CC(=O)OC1=CC=CC=C1C(=O)O
17	24	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
18	25	Osimertinib	COc1cc(N(C)CCN(C)C)c(NC(=O)C=C)cc1Nc1nccc(-c2cn(C)c3ccccc23)n1
19	26	Osimertinib	COc1cc(N(C)CCN(C)C)c(NC(=O)C=C)cc1Nc1nccc(-c2cn(C)c3ccccc23)n1
20	27	Imatinib	Cc1ccc(NC(=O)c2ccc(CN3CCN(C)CC3)cc2)cc1Nc1nccc(-c2cccnc2)n1
21	28	Imatinib	Cc1ccc(NC(=O)c2ccc(CN3CCN(C)CC3)cc2)cc1Nc1nccc(-c2cccnc2)n1
22	29	Imatinib	Cc1ccc(NC(=O)c2ccc(CN3CCN(C)CC3)cc2)cc1Nc1nccc(-c2cccnc2)n1
23	30	Imatinib	Cc1ccc(NC(=O)c2ccc(CN3CCN(C)CC3)cc2)cc1Nc1nccc(-c2cccnc2)n1
24	31	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
25	32	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
26	33	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
27	34	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
28	35	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
29	36	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
30	37	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
31	38	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
32	39	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
33	40	Afatinib	CN(C)C/C=C/C(=O)Nc1cc2c(Nc3ccc(F)c(Cl)c3)ncnc2cc1OC1CCOC1
34	41	Aspirin	CC(=O)OC1=CC=CC=C1C(=O)O
35	42	Aspirin	CC(=O)OC1=CC=CC=C1C(=O)O
36	43	x	CC(=O)OC1=CC=CC=C1C(=O)O
37	44	x	CC(=O)OC1=CC=CC=C1C(=O)O
38	45	amoxicillin	CC1([C@@H](N2[C@H](S1)[C@@H](C2=O)NC(=O)[C@@H](C3=CC=C(C=C3)O)N)C(=O)O)C
39	46	curcumin	COC1=C(C=CC(=C1)/C=C/C(=O)CC(=O)/C=C/C2=CC(=C(C=C2)O)OC)O
40	47	Imatinib	Cc1ccc(NC(=O)c2ccc(CN3CCN(C)CC3)cc2)cc1Nc1nccc(-c2cccnc2)n1
41	48	Imatinib	Cc1ccc(NC(=O)c2ccc(CN3CCN(C)CC3)cc2)cc1Nc1nccc(-c2cccnc2)n1
42	49	Aspirin	CC(=O)OC1=CC=CC=C1C(=O)O
43	50	Aspirin	CC(=O)OC1=CC=CC=C1C(=O)O
44	51	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
45	51	Afatinib	CN(C)C/C=C/C(=O)Nc1cc2c(Nc3ccc(F)c(Cl)c3)ncnc2cc1OC1CCOC1
46	52	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
47	52	Afatinib	CN(C)C/C=C/C(=O)Nc1cc2c(Nc3ccc(F)c(Cl)c3)ncnc2cc1OC1CCOC1
48	53	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
49	54	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
50	55	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
51	56	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
52	57	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
53	58	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
54	59	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
55	60	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
56	61	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
57	62	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
58	63	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
59	64	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
60	65	Afatinib	CN(C)C/C=C/C(=O)Nc1cc2c(Nc3ccc(F)c(Cl)c3)ncnc2cc1OC1CCOC1
61	66	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
62	67	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
63	68	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
64	68	Erlotinib	COCCOc1cc2ncnc(Nc3cccc(C#C)c3)c2cc1OCCOC
65	69	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
66	69	Erlotinib	COCCOc1cc2ncnc(Nc3cccc(C#C)c3)c2cc1OCCOC
67	70	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
68	71	Sotorasib	Cc1ccc(-c2c(C(=O)N3CCN(C(=O)C=C)CC3F)c(C)nn2-c2cc(C(F)(F)F)cnc2N)c(F)c1
69	72	Ivosidenib	FC1=CC(=NC=C1)C1=NC(C2(CC(F)(F)F)CC2)=C(N1[C@@H](C1=CC(Cl)=CC=C1)C(=O)NC1CCN(C)CC1)C#N
70	73	Imatinib	Cc1ccc(NC(=O)c2ccc(CN3CCN(C)CC3)cc2)cc1Nc1nccc(-c2cccnc2)n1
71	74	Lapatinib	CS(=O)(=O)CCNCc1oc(-c2ccc3ncnc(Nc4ccc(OCc5cccc(F)c5)c(Cl)c4)c3c2)cc1
72	75	Crizotinib	C[C@H](Oc1cc(-c2cnn(C3CCNCC3)c2)cnc1N)c1c(Cl)ccc(F)c1Cl
73	76	Crizotinib	C[C@H](Oc1cc(-c2cnn(C3CCNCC3)c2)cnc1N)c1c(Cl)ccc(F)c1Cl
74	77	Capmatinib	Cc1nc2c(C(N)=O)cccc2n1Cc1cnc(-c2ccc(F)cc2F)c(-c2ccnc(N)n2)c1
75	78	Gilteritinib	CCC1(N)CN(c2nc3cc(N4CCC(N5CCN(C)CC5)CC4)c(OC)cc3c(Nc3cc(C)[nH]n3)n2)CC1
76	79	Imatinib	Cc1ccc(NC(=O)c2ccc(CN3CCN(C)CC3)cc2)cc1Nc1nccc(-c2cccnc2)n1
77	80	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
78	81	Ivosidenib	FC1=CC(=NC=C1)C1=NC(C2(CC(F)(F)F)CC2)=C(N1[C@@H](C1=CC(Cl)=CC=C1)C(=O)NC1CCN(C)CC1)C#N
79	82	Imatinib	Cc1ccc(NC(=O)c2ccc(CN3CCN(C)CC3)cc2)cc1Nc1nccc(-c2cccnc2)n1
80	83	Lapatinib	CS(=O)(=O)CCNCc1oc(-c2ccc3ncnc(Nc4ccc(OCc5cccc(F)c5)c(Cl)c4)c3c2)cc1
81	84	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
90	93	Ivosidenib	FC1=CC(=NC=C1)C1=NC(C2(CC(F)(F)F)CC2)=C(N1[C@@H](C1=CC(Cl)=CC=C1)C(=O)NC1CCN(C)CC1)C#N
82	85	Sotorasib	Cc1ccc(-c2c(C(=O)N3CCN(C(=O)C=C)CC3F)c(C)nn2-c2cc(C(F)(F)F)cnc2N)c(F)c1
83	86	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
84	87	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
85	88	Sotorasib	Cc1ccc(-c2c(C(=O)N3CCN(C(=O)C=C)CC3F)c(C)nn2-c2cc(C(F)(F)F)cnc2N)c(F)c1
86	89	Imatinib	Cc1ccc(NC(=O)c2ccc(CN3CCN(C)CC3)cc2)cc1Nc1nccc(-c2cccnc2)n1
87	90	Imatinib	Cc1ccc(NC(=O)c2ccc(CN3CCN(C)CC3)cc2)cc1Nc1nccc(-c2cccnc2)n1
88	91	Imatinib	Cc1ccc(NC(=O)c2ccc(CN3CCN(C)CC3)cc2)cc1Nc1nccc(-c2cccnc2)n1
89	92	Gilteritinib	CCC1(N)CN(c2nc3cc(N4CCC(N5CCN(C)CC5)CC4)c(OC)cc3c(Nc3cc(C)[nH]n3)n2)CC1
91	94	Lapatinib	CS(=O)(=O)CCNCc1oc(-c2ccc3ncnc(Nc4ccc(OCc5cccc(F)c5)c(Cl)c4)c3c2)cc1
92	95	Crizotinib	C[C@H](Oc1cc(-c2cnn(C3CCNCC3)c2)cnc1N)c1c(Cl)ccc(F)c1Cl
93	96	Crizotinib	C[C@H](Oc1cc(-c2cnn(C3CCNCC3)c2)cnc1N)c1c(Cl)ccc(F)c1Cl
94	97	Capmatinib	Cc1nc2c(C(N)=O)cccc2n1Cc1cnc(-c2ccc(F)cc2F)c(-c2ccnc(N)n2)c1
95	98	Ibrutinib	C=CC(=O)N1CCC[C@@H](n2nc(-c3ccc(Oc4ccccc4)cc3)c3c(N)ncnc32)C1
96	99	Vemurafenib	CCCS(=O)(=O)Nc1ccc(F)c(C(=O)c2c[nH]c3ncc(-c4ccc(Cl)cc4)cc23)c1F
97	100	Alpelisib	Cc1ncc(C(F)(F)F)cn1-c1cnc(C(=O)NC(C)(C)C(=O)Nc2cncc(-c3ccc(C(=N)N)cc3)c2)c(-c2ccc(N3CCOCC3)cc2)c1
98	101	Alpelisib	Cc1ncc(C(F)(F)F)cn1-c1cnc(C(=O)NC(C)(C)C(=O)Nc2cncc(-c3ccc(C(=N)N)cc3)c2)c(-c2ccc(N3CCOCC3)cc2)c1
99	102	Ivosidenib	FC1=CC(=NC=C1)C1=NC(C2(CC(F)(F)F)CC2)=C(N1[C@@H](C1=CC(Cl)=CC=C1)C(=O)NC1CCN(C)CC1)C#N
100	103	Imatinib	Cc1ccc(NC(=O)c2ccc(CN3CCN(C)CC3)cc2)cc1Nc1nccc(-c2cccnc2)n1
101	104	Gilteritinib	CCC1(N)CN(c2nc3cc(N4CCC(N5CCN(C)CC5)CC4)c(OC)cc3c(Nc3cc(C)[nH]n3)n2)CC1
102	105	Lapatinib	CS(=O)(=O)CCNCc1oc(-c2ccc3ncnc(Nc4ccc(OCc5cccc(F)c5)c(Cl)c4)c3c2)cc1
103	106	Vemurafenib	CCCS(=O)(=O)Nc1ccc(F)c(C(=O)c2c[nH]c3ncc(-c4ccc(Cl)cc4)cc23)c1F
104	107	Sotorasib	Cc1ccc(-c2c(C(=O)N3CCN(C(=O)C=C)CC3F)c(C)nn2-c2cc(C(F)(F)F)cnc2N)c(F)c1
105	108	Ivosidenib	FC1=CC(=NC=C1)C1=NC(C2(CC(F)(F)F)CC2)=C(N1[C@@H](C1=CC(Cl)=CC=C1)C(=O)NC1CCN(C)CC1)C#N
106	109	Vemurafenib	CCCS(=O)(=O)Nc1ccc(F)c(C(=O)c2c[nH]c3ncc(-c4ccc(Cl)cc4)cc23)c1F
107	110	Imatinib	Cc1ccc(NC(=O)c2ccc(CN3CCN(C)CC3)cc2)cc1Nc1nccc(-c2cccnc2)n1
108	111	Gilteritinib	CCC1(N)CN(c2nc3cc(N4CCC(N5CCN(C)CC5)CC4)c(OC)cc3c(Nc3cc(C)[nH]n3)n2)CC1
109	112	Lapatinib	CS(=O)(=O)CCNCc1oc(-c2ccc3ncnc(Nc4ccc(OCc5cccc(F)c5)c(Cl)c4)c3c2)cc1
110	113	Sotorasib	Cc1ccc(-c2c(C(=O)N3CCN(C(=O)C=C)CC3F)c(C)nn2-c2cc(C(F)(F)F)cnc2N)c(F)c1
111	114	Ivosidenib	FC1=CC(=NC=C1)C1=NC(C2(CC(F)(F)F)CC2)=C(N1[C@@H](C1=CC(Cl)=CC=C1)C(=O)NC1CCN(C)CC1)C#N
112	115	Vemurafenib	CCCS(=O)(=O)Nc1ccc(F)c(C(=O)c2c[nH]c3ncc(-c4ccc(Cl)cc4)cc23)c1F
113	116	Imatinib	Cc1ccc(NC(=O)c2ccc(CN3CCN(C)CC3)cc2)cc1Nc1nccc(-c2cccnc2)n1
114	117	Gilteritinib	CCC1(N)CN(c2nc3cc(N4CCC(N5CCN(C)CC5)CC4)c(OC)cc3c(Nc3cc(C)[nH]n3)n2)CC1
115	118	Lapatinib	CS(=O)(=O)CCNCc1oc(-c2ccc3ncnc(Nc4ccc(OCc5cccc(F)c5)c(Cl)c4)c3c2)cc1
116	119	Sotorasib	Cc1ccc(-c2c(C(=O)N3CCN(C(=O)C=C)CC3F)c(C)nn2-c2cc(C(F)(F)F)cnc2N)c(F)c1
117	120	Imatinib	Cc1ccc(NC(=O)c2ccc(CN3CCN(C)CC3)cc2)cc1Nc1nccc(-c2cccnc2)n1
118	121	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
119	121	Erlotinib	COCCOc1cc2ncnc(Nc3cccc(C#C)c3)c2cc1OCCOC
120	122	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
121	123	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
122	124	Imatinib	Cc1ccc(NC(=O)c2ccc(CN3CCN(C)CC3)cc2)cc1Nc1nccc(-c2cccnc2)n1
123	125	Imatinib	Cc1ccc(NC(=O)c2ccc(CN3CCN(C)CC3)cc2)cc1Nc1nccc(-c2cccnc2)n1
124	126	Imatinib	Cc1ccc(NC(=O)c2ccc(CN3CCN(C)CC3)cc2)cc1Nc1nccc(-c2cccnc2)n1
125	126	Dasatinib	Cc1nc(Nc2ncc(C(=O)Nc3c(C)cccc3Cl)s2)cc(N2CCN(CCO)CC2)n1
126	126	Nilotinib	Cc1ccc(C(=O)Nc2cc(Nc3nccc(-c4cccnc4)n3)c(C)cc2)cc1C(F)(F)F
127	126	Ponatinib	Cc1ccc(C(=O)Nc2ccc(CN3CCN(C)CC3)c(C(F)(F)F)c2)cc1C#Cc1cnc2cccnn12
128	127	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
129	128	Erlotinib	COc1ccc2nc(Nc3ccc(OC)c(Cl)c3)c(C#N)cc2c1
130	129	Erlotinib	COc1ccc2nc(Nc3ccc(OC)c(Cl)c3)c(C#N)cc2c1
131	130	Imatinib	CC(=O)Nc1ccc(NC(=O)c2cccnc2)c(c1)NC(=O)C(C)C
132	131	Crizotinib	c1cc(c2c(c1)nc(s2)Nc3ccc(Cl)cc3F)N4CCN(CC4)C
133	132	Sotorasib	CC(C)c1ccc(cc1)N2C(=O)C(=C(c3cc(ccc3Cl)Cl)C2=O)C(F)(F)F
134	133	Vemurafenib	COc1cc(ccc1NC(=O)c2ccc(Cl)c(Cl)c2)C(=O)Nc3ccc(cc3)C(F)(F)F
135	134	Quizartinib	COc1cc2c(cc1OC)N(C(=O)C)C(=O)c3ccc(NC(=O)c4ccc(F)cc4)cc3N2
136	135	test	asdfghjkl
137	136	test	[Tc]C
138	137	test_garbage_text	asdfghjkl
139	138	test_technetium	[Tc]C
140	139	test_sql_inject	CC'); DROP TABLE jobs; --
141	140	erlotinib	COc1cc2nc(NC(=O)c3ccc(cc3)N4CCOCC4)sc2cc1
142	141	erlotinib	COc1cc2nc(NC(=O)c3ccc(cc3)N4CCOCC4)sc2cc1
143	142	erlotinib	COc1cc2nc(NC(=O)c3ccc(cc3)N4CCOCC4)sc2cc1
144	143	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
145	144	Caffeine	CN1C=NC2=C1C(=O)N(C(=O)N2C)C
146	145	Caffeine	CN1C=NC2=C1C(=O)N(C(=O)N2C)C
147	146	Caffeine	CN1C=NC2=C1C(=O)N(C(=O)N2C)C
148	147	Caffeine	CN1C=NC2=C1C(=O)N(C(=O)N2C)C
149	148	Caffeine	CN1C=NC2=C1C(=O)N(C(=O)N2C)C
150	149	Caffeine	CN1C=NC2=C1C(=O)N(C(=O)N2C)C
151	150	Caffeine	CN1C=NC2=C1C(=O)N(C(=O)N2C)C
152	151	Caffeine	CN1C=NC2=C1C(=O)N(C(=O)N2C)C
153	152	Caffeine	CN1C=NC2=C1C(=O)N(C(=O)N2C)C
154	153	Caffeine	CN1C=NC2=C1C(=O)N(C(=O)N2C)C
155	154	Caffeine	CN1C=NC2=C1C(=O)N(C(=O)N2C)C
156	155	Caffeine	CN1C=NC2=C1C(=O)N(C(=O)N2C)C
157	156	Caffeine	CN1C=NC2=C1C(=O)N(C(=O)N2C)C
158	157	Caffeine	CN1C=NC2=C1C(=O)N(C(=O)N2C)C
159	158	Caffeine	CN1C=NC2=C1C(=O)N(C(=O)N2C)C
160	159	Caffeine	CN1C=NC2=C1C(=O)N(C(=O)N2C)C
161	160	Caffeine	CN1C=NC2=C1C(=O)N(C(=O)N2C)C
162	161	Caffeine	CN1C=NC2=C1C(=O)N(C(=O)N2C)C
163	162	Caffeine	CN1C=NC2=C1C(=O)N(C(=O)N2C)C
164	163	Caffeine	CN1C=NC2=C1C(=O)N(C(=O)N2C)C
165	164	Caffeine	CN1C=NC2=C1C(=O)N(C(=O)N2C)C
166	165	Caffeine	CN1C=NC2=C1C(=O)N(C(=O)N2C)C
167	166	Caffeine	CN1C=NC2=C1C(=O)N(C(=O)N2C)C
168	167	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
169	168	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
170	168	Erlotinib	COCCOc1cc2ncnc(Nc3cccc(C#C)c3)c2cc1OCCOC
171	168	Osimertinib	COc1cc(N(C)CCN(C)C)c(NC(=O)C=C)cc1Nc1nccc(-c2cn(C)c3ccccc23)n1
172	168	Afatinib	CN(C)C/C=C/C(=O)Nc1cc2c(Nc3ccc(F)c(Cl)c3)ncnc2cc1OC1CCOC1
173	169	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
174	170	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
175	171	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
176	172	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
177	174	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
178	174	Afatinib	CN(C)C/C=C/C(=O)Nc1cc2c(Nc3ccc(F)c(Cl)c3)ncnc2cc1OC1CCOC1
179	173	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
180	173	Afatinib	CN(C)C/C=C/C(=O)Nc1cc2c(Nc3ccc(F)c(Cl)c3)ncnc2cc1OC1CCOC1
181	175	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
182	175	Afatinib	CN(C)C/C=C/C(=O)Nc1cc2c(Nc3ccc(F)c(Cl)c3)ncnc2cc1OC1CCOC1
184	176	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
183	177	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
185	178	Afatinib	CN(C)C/C=C/C(=O)Nc1cc2c(Nc3ccc(F)c(Cl)c3)ncnc2cc1OC1CCOC1
186	179	Afatinib	CN(C)C/C=C/C(=O)Nc1cc2c(Nc3ccc(F)c(Cl)c3)ncnc2cc1OC1CCOC1
187	181	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
188	181	Erlotinib	COCCOc1cc2ncnc(Nc3cccc(C#C)c3)c2cc1OCCOC
189	181	Osimertinib	COc1cc(N(C)CCN(C)C)c(NC(=O)C=C)cc1Nc1nccc(-c2cn(C)c3ccccc23)n1
190	181	Afatinib	CN(C)C/C=C/C(=O)Nc1cc2c(Nc3ccc(F)c(Cl)c3)ncnc2cc1OC1CCOC1
191	180	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
192	180	Erlotinib	COCCOc1cc2ncnc(Nc3cccc(C#C)c3)c2cc1OCCOC
193	180	Osimertinib	COc1cc(N(C)CCN(C)C)c(NC(=O)C=C)cc1Nc1nccc(-c2cn(C)c3ccccc23)n1
194	180	Afatinib	CN(C)C/C=C/C(=O)Nc1cc2c(Nc3ccc(F)c(Cl)c3)ncnc2cc1OC1CCOC1
195	182	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
196	182	Erlotinib	COCCOc1cc2ncnc(Nc3cccc(C#C)c3)c2cc1OCCOC
197	182	Osimertinib	COc1cc(N(C)CCN(C)C)c(NC(=O)C=C)cc1Nc1nccc(-c2cn(C)c3ccccc23)n1
198	182	Afatinib	CN(C)C/C=C/C(=O)Nc1cc2c(Nc3ccc(F)c(Cl)c3)ncnc2cc1OC1CCOC1
199	183	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
200	183	Afatinib	CN(C)C/C=C/C(=O)Nc1cc2c(Nc3ccc(F)c(Cl)c3)ncnc2cc1OC1CCOC1
201	184	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
202	184	Afatinib	CN(C)C/C=C/C(=O)Nc1cc2c(Nc3ccc(F)c(Cl)c3)ncnc2cc1OC1CCOC1
203	185	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
204	186	Gefitinib	COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1
205	186	Afatinib	CN(C)C/C=C/C(=O)Nc1cc2c(Nc3ccc(F)c(Cl)c3)ncnc2cc1OC1CCOC1
206	187	Sotorasib	Cc1ncc(F)c(-c2c(Cl)cccc2O)c1C(=O)N1CCN(C(=O)C=C)CC1c2nc(C(C)C)cn2C
207	187	Adagrasib	Cc1cnc2c(c1Cl)c(O)c(C)c(C)c2C(=O)N1CCN(C(=O)C=C)CC1Cn1cc(F)cn1
\.


--
-- Data for Name: dockingresult; Type: TABLE DATA; Schema: public; Owner: -
--

COPY "public"."dockingresult" ("id", "job_id", "compound_id", "variant", "best_score", "pose_uri", "extra", "created_at") FROM stdin;
1	1	1	T790M	-7.1	/Users/arash/.deltadock/poses/job1_c1_T790M.pdbqt	foldx_ddg=-0.38|engine=pod_gpu|confidence=medium|posebusters=failed: inchi_convertible,no_radicals|prolif=empty|summary=Medium-confidence pose (a few posebusters checks failed)	2026-04-27 20:59:51.606982
2	11	7	T790M	0	\N	ligand_prep_failed: Could not parse SMILES after strict, loose-sanitize, and Open Babel fallbacks: 'not-a-real-smiles!!!'. The structure may be invalid or use a feature none of the parsers support.	2026-04-27 21:27:23.638379
3	7	2	WT	-8	/Users/arash/.deltadock/poses/job7_c2_WT.pdbqt	pocket=auto(HYZ)|engine=pod_gpu|confidence=medium|posebusters=failed: inchi_convertible,no_radicals|prolif=empty|summary=Medium-confidence pose (a few posebusters checks failed)	2026-04-27 21:27:35.274717
4	9	4	WT	-7.7	/Users/arash/.deltadock/poses/job9_c4_WT.pdbqt	pocket=auto(HYZ)|engine=pod_gpu|confidence=medium|posebusters=failed: inchi_convertible,no_radicals|prolif=empty|summary=Medium-confidence pose (a few posebusters checks failed)	2026-04-27 21:27:36.600146
5	10	5	WT	-8.8	/Users/arash/.deltadock/poses/job10_c5_WT.pdbqt	pocket=auto(HYZ)|engine=pod_gpu|confidence=medium|posebusters=failed: inchi_convertible,no_radicals|prolif=empty|summary=Medium-confidence pose (a few posebusters checks failed)	2026-04-27 21:27:47.442225
6	9	4	T790M	-6.9	/Users/arash/.deltadock/poses/job9_c4_T790M.pdbqt	foldx_ddg=-0.38|engine=pod_gpu|confidence=medium|posebusters=failed: inchi_convertible,no_radicals|prolif=empty|summary=Medium-confidence pose (a few posebusters checks failed)	2026-04-27 21:27:49.995554
7	10	5	T790M	-7.1	/Users/arash/.deltadock/poses/job10_c5_T790M.pdbqt	foldx_ddg=-0.38|engine=pod_gpu|confidence=medium|posebusters=failed: inchi_convertible,no_radicals|contacts=LEU718:Hydr:3.8,LEU718:VdWC:2.5,VAL726:VdWC:2.5,GLY796:VdWC:2.8,GLY719:VdWC:2.8|summary=Medium-confidence pose (a few posebusters checks failed) Key contacts: hydrophobic with LEU718; van der Waals with GLY719; van der Waals with GLY796; van der Waals with LEU1001.	2026-04-27 21:27:59.915033
8	8	3	T790M+C797S	-7.4	/Users/arash/.deltadock/poses/job8_c3_T790M+C797S.pdbqt	foldx_ddg=-0.82|engine=pod_gpu|confidence=medium|posebusters=failed: inchi_convertible,no_radicals|contacts=VAL726:Hydr:4.3,VAL726:VdWC:2.8,LEU718:VdWC:2.6,LEU799:VdWC:2.3,LYS745:VdWC:3.0|summary=Medium-confidence pose (a few posebusters checks failed) Key contacts: hydrophobic with ARG841; hydrophobic with VAL726; van der Waals with ASP800; van der Waals with GLY796.	2026-04-27 21:28:13.78001
9	10	5	L858R	-7.6	/Users/arash/.deltadock/poses/job10_c5_L858R.pdbqt	foldx_ddg=3.30|engine=pod_gpu|confidence=medium|posebusters=failed: inchi_convertible,no_radicals|prolif=empty|summary=Medium-confidence pose (a few posebusters checks failed)	2026-04-27 21:28:15.744776
10	10	6	WT	-9	/Users/arash/.deltadock/poses/job10_c6_WT.pdbqt	pocket=auto(HYZ)|engine=pod_gpu|confidence=medium|posebusters=failed: inchi_convertible,no_radicals|prolif=empty|summary=Medium-confidence pose (a few posebusters checks failed)	2026-04-27 21:28:46.266658
11	10	6	T790M	-6.8	/Users/arash/.deltadock/poses/job10_c6_T790M.pdbqt	foldx_ddg=-0.38|engine=pod_gpu|confidence=medium|posebusters=failed: inchi_convertible,no_radicals|prolif=empty|summary=Medium-confidence pose (a few posebusters checks failed)	2026-04-27 21:29:58.8591
12	10	6	L858R	-7.3	/Users/arash/.deltadock/poses/job10_c6_L858R.pdbqt	foldx_ddg=3.30|engine=pod_gpu|confidence=medium|posebusters=failed: inchi_convertible,no_radicals|contacts=VAL726:Hydr:4.4,VAL726:VdWC:2.8,LYS745:VdWC:2.7,CYS797:Hydr:4.2,CYS797:VdWC:2.9|summary=Medium-confidence pose (a few posebusters checks failed) Key contacts: hydrophobic with CYS797; hydrophobic with VAL726; van der Waals with ARG841; van der Waals with GLY796.	2026-04-27 21:31:47.267289
13	15	8	L858R	-7.2	/Users/arash/.deltadock/poses/job15_c8_L858R.pdbqt	foldx_ddg=3.30|engine=pod_gpu|confidence=medium|posebusters=failed: no_radicals|prolif=empty|summary=Medium-confidence pose (a few posebusters checks failed)	2026-04-27 21:53:37.612238
14	16	9	WT	-7.3	/Users/arash/.deltadock/poses/job16_c9_WT.pdbqt	pocket=catalog|engine=pod_gpu|confidence=medium|posebusters=failed: inchi_convertible,no_radicals|prolif=empty|summary=Medium-confidence pose (a few posebusters checks failed)	2026-04-27 22:00:03.612889
15	16	9	T790M	-6.5	/Users/arash/.deltadock/poses/job16_c9_T790M.pdbqt	foldx_ddg=-0.66|engine=pod_gpu|confidence=medium|posebusters=failed: inchi_convertible,no_radicals|contacts=LYS745:VdWC:2.5,MET793:Hydr:4.1,LEU844:Hydr:4.5,LEU844:VdWC:2.7,LEU718:VdWC:3.4|summary=Medium-confidence pose (a few posebusters checks failed) Key contacts: hydrophobic with LEU844; hydrophobic with MET793; hydrophobic with VAL726; van der Waals with ARG841.	2026-04-27 22:01:52.426387
16	17	10	WT	-7.34	\N	placeholder (missing python dep: No module named 'rdkit.six')	2026-04-27 23:47:10.523434
17	17	10	F691L	-8.690000000000001	\N	placeholder (missing python dep: No module named 'rdkit.six')	2026-04-27 23:47:10.523797
18	18	11	WT	-7.92	\N	placeholder (missing python dep: No module named 'gemmi')	2026-04-28 00:05:04.858105
19	18	11	T790M	-9.42	\N	placeholder (missing python dep: No module named 'gemmi')	2026-04-28 00:05:04.858433
20	19	12	WT	-8.6	/var/lib/liganx/poses/job19_c12_WT.pdbqt	pocket=auto(HYZ)|engine=pod_gpu|confidence=unknown|posebusters=check_skipped: timeout|prolif=empty|summary=No interaction data.	2026-04-28 00:12:02.118211
21	19	12	T790M	-8.6	/var/lib/liganx/poses/job19_c12_T790M.pdbqt	no_foldx_dock_against_wt|engine=pod_gpu|confidence=unknown|posebusters=check_skipped: timeout|prolif=empty|summary=No interaction data.	2026-04-28 00:14:07.315651
22	20	13	WT	-8.8	/var/lib/liganx/poses/job20_c13_WT.pdbqt	pocket=auto(HYZ)|engine=pod_gpu|confidence=unknown|posebusters=check_skipped: timeout|prolif=empty|summary=No interaction data.	2026-04-28 00:15:02.596705
23	21	14	WT	-7.1	/var/lib/liganx/poses/job21_c14_WT.pdbqt	pocket=catalog|engine=pod_gpu|confidence=medium|posebusters=failed: no_radicals|prolif=empty|summary=Medium-confidence pose (a few posebusters checks failed)	2026-04-28 00:16:16.19525
24	20	13	T790M	-8.8	/var/lib/liganx/poses/job20_c13_T790M.pdbqt	no_foldx_dock_against_wt|engine=pod_gpu|confidence=unknown|posebusters=check_skipped: timeout|prolif=empty|summary=No interaction data.	2026-04-28 00:17:08.995496
25	21	14	T670I	-7.1	/var/lib/liganx/poses/job21_c14_T670I.pdbqt	no_foldx_dock_against_wt|engine=pod_gpu|confidence=medium|posebusters=failed: no_radicals|contacts=THR670:HBDo:3.1,THR670:HBAc:3.2,THR670:VdWC:2.7,VAL668:VdWC:2.7,LYS623:Hydr:3.9|summary=Medium-confidence pose (a few posebusters checks failed) Key contacts: hydrophobic with CYS809; hydrophobic with LYS623; H-bond acceptor + H-bond donor with THR670; hydrophobic with VAL654.	2026-04-28 00:17:51.09155
26	21	14	D816V	-7.1	/var/lib/liganx/poses/job21_c14_D816V.pdbqt	no_foldx_dock_against_wt|engine=pod_gpu|confidence=medium|posebusters=failed: no_radicals|contacts=THR670:HBDo:3.1,THR670:HBAc:3.2,THR670:VdWC:2.7,VAL668:VdWC:2.7,LYS623:Hydr:3.9|summary=Medium-confidence pose (a few posebusters checks failed) Key contacts: hydrophobic with CYS809; hydrophobic with LYS623; H-bond acceptor + H-bond donor with THR670; hydrophobic with VAL654.	2026-04-28 00:18:53.336221
27	21	14	V654A	-7.1	/var/lib/liganx/poses/job21_c14_V654A.pdbqt	no_foldx_dock_against_wt|engine=pod_gpu|confidence=medium|posebusters=failed: no_radicals|contacts=VAL654:Hydr:4.3,VAL654:VdWC:2.7,THR670:HBDo:3.1,THR670:HBAc:3.2,THR670:VdWC:2.7|summary=Medium-confidence pose (a few posebusters checks failed) Key contacts: hydrophobic with CYS809; hydrophobic with LYS623; H-bond acceptor + H-bond donor with THR670; hydrophobic with VAL654.	2026-04-28 00:19:51.091965
28	23	16	WT	-5.4	/var/lib/liganx/poses/job23_c16_WT.pdbqt	pocket=catalog|engine=pod_gpu|confidence=medium|posebusters=failed: no_radicals|contacts=GLY2032:VdWC:2.7,MET2029:HBAc:3.1,MET2029:VdWC:2.6,LEU2086:VdWC:2.6,VAL1959:Hydr:4.3|summary=Medium-confidence pose (a few posebusters checks failed) Key contacts: H-bond acceptor with MET2029; hydrophobic with VAL1959; van der Waals with GLY2032; van der Waals with LEU2028.	2026-04-28 00:32:57.377591
29	24	17	WT	-6.8	/var/lib/liganx/poses/job24_c17_WT.pdbqt	pocket=catalog|engine=pod_gpu|confidence=medium|posebusters=failed: inchi_convertible,no_radicals|prolif=empty|summary=Medium-confidence pose (a few posebusters checks failed)	2026-04-28 00:34:57.686487
30	24	17	T790M	-6.8	/var/lib/liganx/poses/job24_c17_T790M.pdbqt	no_foldx_dock_against_wt|engine=pod_gpu|confidence=medium|posebusters=failed: inchi_convertible,no_radicals|prolif=empty|summary=Medium-confidence pose (a few posebusters checks failed)	2026-04-28 00:35:06.84918
31	24	17	L858R	-6.8	/var/lib/liganx/poses/job24_c17_L858R.pdbqt	no_foldx_dock_against_wt|engine=pod_gpu|confidence=medium|posebusters=failed: inchi_convertible,no_radicals|contacts=ASP2033:VdWC:2.6,LEU2028:VdWC:2.4,LEU2010:VdWC:2.8,VAL1959:VdWC:2.6,MET2029:HBAc:3.4|summary=Medium-confidence pose (a few posebusters checks failed) Key contacts: H-bond acceptor with MET2029; van der Waals with ASP2033; van der Waals with GLY1957; van der Waals with LEU2010.	2026-04-28 00:35:16.674208
32	24	17	C797S	-6.8	/var/lib/liganx/poses/job24_c17_C797S.pdbqt	no_foldx_dock_against_wt|engine=pod_gpu|confidence=medium|posebusters=failed: inchi_convertible,no_radicals|prolif=empty|summary=Medium-confidence pose (a few posebusters checks failed)	2026-04-28 00:35:25.326883
33	25	18	WT	-9.1	/var/lib/liganx/poses/job25_c18_WT.pdbqt	pocket=auto(HYZ)|engine=pod_gpu|confidence=medium|posebusters=failed: inchi_convertible,no_radicals|prolif=empty|summary=Medium-confidence pose (a few posebusters checks failed)	2026-04-28 00:54:13.461861
34	25	18	T790M	-9.1	/var/lib/liganx/poses/job25_c18_T790M.pdbqt	no_foldx_dock_against_wt|engine=pod_gpu|confidence=medium|posebusters=failed: inchi_convertible,no_radicals|contacts=LEU718:VdWC:3.2,CYS775:Hydr:4.3,PHE856:Hydr:4.3,LEU777:Hydr:4.1,LEU788:Hydr:4.5|summary=Medium-confidence pose (a few posebusters checks failed) Key contacts: hydrophobic with CYS775; hydrophobic with LEU777; hydrophobic with LEU788; hydrophobic with LYS745.	2026-04-28 00:54:24.399591
35	26	19	WT	-9.3	/var/lib/liganx/poses/job26_c19_WT.pdbqt	pocket=auto(HYZ)|engine=pod_gpu|confidence=medium|posebusters=failed: inchi_convertible,no_radicals|prolif=empty|summary=Medium-confidence pose (a few posebusters checks failed)	2026-04-28 00:54:36.089397
36	26	19	T790M	-9.3	/var/lib/liganx/poses/job26_c19_T790M.pdbqt	no_foldx_dock_against_wt|engine=pod_gpu|confidence=medium|posebusters=failed: inchi_convertible,no_radicals|prolif=empty|summary=Medium-confidence pose (a few posebusters checks failed)	2026-04-28 00:54:47.117267
37	30	23	WT	-9.4	/var/lib/liganx/poses/job30_c23_WT.pdbqt	pocket=auto(P16)|engine=pod_gpu|confidence=medium|posebusters=failed: inchi_convertible,no_radicals|contacts=PHE401:VdWC:3.3,LEU389:Hydr:3.7,LEU389:VdWC:3.4,GLY268:VdWC:2.7,HIS265:Hydr:3.8|summary=Medium-confidence pose (a few posebusters checks failed) Key contacts: hydrophobic with HIS265; hydrophobic with LEU267; hydrophobic with LEU389; hydrophobic with PHE336.	2026-04-28 01:05:25.842524
38	31	24	WT	-8.6	/var/lib/liganx/poses/job31_c24_WT.pdbqt	pocket=auto(HYZ)|engine=pod_gpu|confidence=medium|strain=high:259.5|posebusters=failed: inchi_convertible,no_radicals|prolif=empty|summary=Medium-confidence pose (a few posebusters checks failed)	2026-04-28 01:24:02.405639
39	31	24	T790M	-8.6	/var/lib/liganx/poses/job31_c24_T790M.pdbqt	no_foldx_dock_against_wt|engine=pod_gpu|confidence=medium|strain=high:259.5|posebusters=failed: inchi_convertible,no_radicals|prolif=empty|summary=Medium-confidence pose (a few posebusters checks failed)	2026-04-28 01:24:12.653844
40	32	25	WT	-8.6	/var/lib/liganx/poses/job32_c25_WT.pdbqt	pocket=auto(HYZ)|engine=pod_gpu|confidence=medium|strain=high:258.7|posebusters=failed: inchi_convertible,no_radicals|prolif=empty|summary=Medium-confidence pose (a few posebusters checks failed)	2026-04-28 01:27:22.970694
41	32	25	T790M	-8.6	/var/lib/liganx/poses/job32_c25_T790M.pdbqt	no_foldx_dock_against_wt|engine=pod_gpu|confidence=medium|strain=high:258.7|posebusters=failed: inchi_convertible,no_radicals|prolif=empty|summary=Medium-confidence pose (a few posebusters checks failed)	2026-04-28 01:27:33.487045
42	33	26	WT	-8.6	/var/lib/liganx/poses/job33_c26_WT.pdbqt	pocket=auto(HYZ)|engine=pod_gpu|confidence=medium|posebusters=failed: inchi_convertible,no_radicals|prolif=empty|summary=Medium-confidence pose (a few posebusters checks failed)	2026-04-28 01:32:08.640737
43	33	26	T790M	-8.6	/var/lib/liganx/poses/job33_c26_T790M.pdbqt	no_foldx_dock_against_wt|engine=pod_gpu|confidence=medium|posebusters=failed: inchi_convertible,no_radicals|prolif=empty|summary=Medium-confidence pose (a few posebusters checks failed)	2026-04-28 01:32:18.685737
44	34	27	WT	-8.6	/var/lib/liganx/poses/job34_c27_WT.pdbqt	pocket=auto(HYZ)|engine=pod_gpu|confidence=medium|posebusters=failed: inchi_convertible,no_radicals|prolif=empty|summary=Medium-confidence pose (a few posebusters checks failed)	2026-04-28 01:36:58.452511
45	34	27	T790M	-8.6	/var/lib/liganx/poses/job34_c27_T790M.pdbqt	no_foldx_dock_against_wt|engine=pod_gpu|confidence=medium|posebusters=failed: inchi_convertible,no_radicals|prolif=empty|summary=Medium-confidence pose (a few posebusters checks failed)	2026-04-28 01:37:08.983456
46	35	28	WT	-8.6	/var/lib/liganx/poses/job35_c28_WT.pdbqt	pocket=auto(HYZ)|engine=pod_gpu|confidence=medium|strain=mild:1.6|posebusters=failed: inchi_convertible,no_radicals|prolif=empty|summary=Medium-confidence pose (a few posebusters checks failed)	2026-04-28 01:40:07.250336
47	35	28	T790M	-8.6	/var/lib/liganx/poses/job35_c28_T790M.pdbqt	no_foldx_dock_against_wt|engine=pod_gpu|confidence=medium|strain=mild:1.6|posebusters=failed: inchi_convertible,no_radicals|prolif=empty|summary=Medium-confidence pose (a few posebusters checks failed)	2026-04-28 01:40:18.314018
48	36	29	WT	-8.6	/var/lib/liganx/poses/job36_c29_WT.pdbqt	pocket=auto(HYZ)|engine=pod_gpu|confidence=unknown|strain=mild:1.6|posebusters=passed all 0 checks|contacts=THR790:VdWC:2.5,ASP855:Hydr:4.4,ASP855:VdWC:2.5,LEU858:Hydr:3.9,LYS745:Hydr:4.1|summary=Key contacts: hydrophobic with ASP855; hydrophobic with LEU858; hydrophobic with LYS745; hydrophobic with MET766.	2026-04-28 01:48:04.196314
70	52	47	WT	-5.2	/var/lib/liganx/poses/job52_c47_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-5.50|confidence=unknown|strain=mild:1.29|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 03:56:39.037279
49	36	29	T790M	-8.6	/var/lib/liganx/poses/job36_c29_T790M.pdbqt	no_foldx_dock_against_wt|engine=pod_gpu|confidence=unknown|strain=mild:1.6|posebusters=passed all 0 checks|contacts=MET766:Hydr:4.1,MET766:VdWC:3.4,LYS745:Hydr:4.1,LYS745:VdWC:2.7,VAL726:Hydr:4.2|summary=Key contacts: hydrophobic with ASP855; hydrophobic with LEU858; hydrophobic with LYS745; hydrophobic with MET766.	2026-04-28 01:48:13.017458
50	37	30	WT	-8.6	/var/lib/liganx/poses/job37_c30_WT.pdbqt	pocket=auto(HYZ)|engine=pod_gpu|confidence=unknown|strain=mild:1.6|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 01:51:00.768715
51	37	30	T790M	-8.6	/var/lib/liganx/poses/job37_c30_T790M.pdbqt	no_foldx_dock_against_wt|engine=pod_gpu|confidence=unknown|strain=mild:1.6|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 01:51:10.003152
52	38	31	WT	-8.6	/var/lib/liganx/poses/job38_c31_WT.pdbqt	pocket=auto(HYZ)|engine=pod_gpu|vinardo=-8.63|confidence=unknown|strain=mild:1.6|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 01:54:29.542687
53	38	31	T790M	-8.6	/var/lib/liganx/poses/job38_c31_T790M.pdbqt	no_foldx_dock_against_wt|engine=pod_gpu|vinardo=-8.63|confidence=unknown|strain=mild:1.6|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 01:54:38.937682
54	39	32	WT	-7	/var/lib/liganx/poses/job39_c32_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-3.93|confidence=unknown|strain=mild:1.57|posebusters=passed all 0 checks|contacts=ASP855:HBDo:3.3,ASP855:VdWC:2.5,THR854:VdWC:3.4,THR790:VdWC:2.6,LYS745:Hydr:4.0|summary=Key contacts: H-bond donor with ASP855; hydrophobic with LYS745; van der Waals with LEU844; van der Waals with MET766.	2026-04-28 01:59:19.006808
55	39	32	T790M	-7	/var/lib/liganx/poses/job39_c32_T790M.pdbqt	no_foldx_dock_against_wt|engine=pod_gpu|vinardo=-3.93|confidence=unknown|strain=mild:1.57|posebusters=passed all 0 checks|contacts=LYS745:Hydr:4.0,LYS745:VdWC:2.7,MET766:VdWC:2.5,ASP855:HBDo:3.3,ASP855:VdWC:2.5|summary=Key contacts: H-bond donor with ASP855; hydrophobic with LYS745; van der Waals with LEU844; van der Waals with MET766.	2026-04-28 01:59:27.716325
56	40	33	WT	-7.7	/var/lib/liganx/poses/job40_c33_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-6.34|confidence=unknown|strain=mild:1.63|posebusters=passed all 0 checks|contacts=ALA722:VdWC:3.4,GLY724:HBAc:3.3,GLY724:VdWC:2.6,PHE723:VdWC:2.7,VAL726:Hydr:4.4|summary=Key contacts: H-bond acceptor with GLY724; H-bond acceptor + hydrophobic with LYS745; hydrophobic with VAL726; van der Waals with ALA722.	2026-04-28 02:26:56.043166
57	42	35	WT	-6.3	/var/lib/liganx/poses/job42_c35_WT.pdbqt	pocket=auto(HYZ)|engine=pod_gpu|vinardo=-5.73|confidence=high|strain=ok:0.99|posebusters=passed all 20 checks|prolif=empty|summary=High-confidence pose (no posebusters checks failed)	2026-04-28 02:36:40.008533
58	43	36	WT	-6.3	/var/lib/liganx/poses/job43_c36_WT.pdbqt	pocket=auto(HYZ)|engine=pod_gpu|vinardo=-5.07|confidence=high|strain=mild:1.08|posebusters=passed all 20 checks|contacts=LYS745:Hydr:4.4,LEU788:Hydr:4.1,LEU788:VdWC:3.3,LEU777:Hydr:4.3,LEU777:VdWC:2.8|summary=High-confidence pose (no posebusters checks failed) Key contacts: hydrophobic with LEU777; hydrophobic with LEU788; hydrophobic with LEU858; hydrophobic with LYS745.	2026-04-28 02:42:18.041185
59	44	37	WT	-6.3	/var/lib/liganx/poses/job44_c37_WT.pdbqt	pocket=auto(HYZ)|engine=pod_gpu|vinardo=-5.73|confidence=high|strain=ok:0.99|posebusters=passed all 20 checks|prolif=empty|summary=High-confidence pose (no posebusters checks failed)	2026-04-28 02:44:53.04729
60	45	38	WT	-6.6	/var/lib/liganx/poses/job45_c38_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-4.68|confidence=high|strain=ok:0.77|posebusters=passed all 20 checks|prolif=empty|summary=High-confidence pose (no posebusters checks failed)	2026-04-28 02:45:47.786021
61	46	39	WT	-4.1	/var/lib/liganx/poses/job46_c39_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-4.44|confidence=unknown|strain=high:2.67|posebusters=check_skipped: timeout|contacts=LYS147:Hydr:4.0,THR148:VdWC:2.8,PHE28:HBAc:3.0,PHE28:VdWC:3.0,ARG149:Hydr:3.9|summary=Key contacts: hydrophobic with ARG149; hydrophobic with LYS147; H-bond acceptor with PHE28; van der Waals with THR148.	2026-04-28 02:48:03.59663
62	46	39	Q61H	-4.1	/var/lib/liganx/poses/job46_c39_Q61H.pdbqt	no_foldx_dock_against_wt|engine=pod_gpu|vinardo=-4.44|confidence=unknown|strain=high:2.67|posebusters=check_skipped: timeout|contacts=LYS147:Hydr:4.0,PHE28:HBAc:3.0,PHE28:VdWC:3.0,THR148:VdWC:2.8,ARG149:Hydr:3.9|summary=Key contacts: hydrophobic with ARG149; hydrophobic with LYS147; H-bond acceptor with PHE28; van der Waals with THR148.	2026-04-28 02:49:09.938219
63	47	40	WT	-4	/var/lib/liganx/poses/job47_c40_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-3.35|confidence=unknown|strain=mild:1.39|posebusters=passed all 0 checks|contacts=LEU445:HBAc:3.1,LEU445:VdWC:2.2,ASP391:Hydr:4.3,ASP444:Hydr:4.1|summary=Key contacts: hydrophobic with ASP391; hydrophobic with ASP444; H-bond acceptor with LEU445.	2026-04-28 03:14:53.108622
64	48	41	WT	-4.4	/var/lib/liganx/poses/job48_c41_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-4.47|confidence=unknown|strain=high:2.07|posebusters=passed all 0 checks|contacts=LYS404:VdWC:2.7,ASP391:Hydr:4.0,ASP391:VdWC:2.7,LEU445:Hydr:4.5,LEU445:VdWC:2.8|summary=Key contacts: hydrophobic with ASP391; hydrophobic with LEU445; van der Waals with LYS404.	2026-04-28 03:15:30.420936
65	49	42	WT	-5.6	/var/lib/liganx/poses/job49_c42_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-4.08|confidence=high|strain=mild:1.06|posebusters=passed all 20 checks|contacts=GLN791:VdWC:3.0,MET793:HBAc:2.9,MET793:VdWC:2.6,THR790:VdWC:2.6,VAL726:Hydr:4.4|summary=High-confidence pose (no posebusters checks failed) Key contacts: H-bond acceptor with MET793; hydrophobic with VAL726; van der Waals with GLN791; van der Waals with THR790.	2026-04-28 03:53:37.192243
66	50	43	WT	-3.9	/var/lib/liganx/poses/job50_c43_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-3.80|confidence=high|strain=ok:0.93|posebusters=passed all 20 checks|contacts=GLN22:HBAc:3.1,GLN22:VdWC:3.1,LYS147:Hydr:4.3,HIS27:VdWC:2.6,PHE28:Hydr:4.5|summary=High-confidence pose (no posebusters checks failed) Key contacts: H-bond acceptor with GLN22; hydrophobic with LYS147; H-bond acceptor + hydrophobic + π-stacking with PHE28; van der Waals with HIS27.	2026-04-28 03:54:18.264917
67	50	43	Q61H	-3.9	/var/lib/liganx/poses/job50_c43_Q61H.pdbqt	no_foldx_dock_against_wt|engine=pod_gpu|vinardo=-3.80|confidence=high|strain=ok:0.93|posebusters=passed all 20 checks|contacts=HIS27:VdWC:2.6,LYS147:Hydr:4.3,PHE28:Hydr:4.5,PHE28:HBAc:2.8,PHE28:PiSt:5.2|summary=High-confidence pose (no posebusters checks failed) Key contacts: H-bond acceptor with GLN22; hydrophobic with LYS147; H-bond acceptor + hydrophobic + π-stacking with PHE28; van der Waals with HIS27.	2026-04-28 03:54:24.805219
68	52	46	WT	-4.7	/var/lib/liganx/poses/job52_c46_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-5.75|confidence=unknown|strain=mild:1.89|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 03:56:16.556399
69	52	46	D835V	-4.7	/var/lib/liganx/poses/job52_c46_D835V.pdbqt	no_foldx_dock_against_wt|engine=pod_gpu|vinardo=-5.75|confidence=unknown|strain=mild:1.89|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 03:56:26.923814
71	52	47	D835V	-5.2	/var/lib/liganx/poses/job52_c47_D835V.pdbqt	no_foldx_dock_against_wt|engine=pod_gpu|vinardo=-5.50|confidence=unknown|strain=mild:1.29|posebusters=passed all 0 checks|contacts=LYS907:Hydr:3.8,LYS907:HBDo:3.3,LYS907:VdWC:2.5,TYR919:VdWC:2.7,MET908:VdWC:2.6|summary=Key contacts: hydrophobic with ASP909; H-bond donor + hydrophobic with LYS907; van der Waals with MET908; van der Waals with TYR919.	2026-04-28 03:56:50.332796
75	54	49	D835V	-5	/var/lib/liganx/poses/job54_c49_D835V.pdbqt	no_foldx_dock_against_wt|engine=pod_gpu|vinardo=-5.44|confidence=unknown|strain=mild:1.31|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 04:16:57.120041
78	56	51	WT	-5.1	/var/lib/liganx/poses/job56_c51_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-5.30|confidence=unknown|strain=ok:0.98|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 04:21:46.722788
72	53	48	WT	-5.2	/var/lib/liganx/poses/job53_c48_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-6.37|confidence=unknown|strain=mild:1.05|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 04:14:41.817786
76	55	50	WT	-4.9	/var/lib/liganx/poses/job55_c50_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-5.33|confidence=unknown|strain=mild:1.64|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 04:17:54.29896
73	53	48	D835V	-5.2	/var/lib/liganx/poses/job53_c48_D835V.pdbqt	no_foldx_dock_against_wt|engine=pod_gpu|vinardo=-6.37|confidence=unknown|strain=mild:1.05|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 04:14:50.069807
74	54	49	WT	-5	/var/lib/liganx/poses/job54_c49_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-5.44|confidence=unknown|strain=mild:1.31|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 04:16:49.310217
77	55	50	D835V	-4.9	/var/lib/liganx/poses/job55_c50_D835V.pdbqt	no_foldx_dock_against_wt|engine=pod_gpu|vinardo=-5.33|confidence=unknown|strain=mild:1.64|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 04:18:02.266411
79	56	51	D835V	-5.1	/var/lib/liganx/poses/job56_c51_D835V.pdbqt	no_foldx_dock_against_wt|engine=pod_gpu|vinardo=-5.30|confidence=unknown|strain=ok:0.98|posebusters=passed all 0 checks|contacts=ASN904:HBAc:2.9,ASN904:VdWC:2.9,PHE928:Hydr:3.7,GLY905:VdWC:3.2,LYS907:Hydr:4.1|summary=Key contacts: H-bond acceptor with ASN904; H-bond acceptor + hydrophobic with LYS907; hydrophobic with PHE928; van der Waals with GLY905.	2026-04-28 04:21:54.94929
80	57	52	WT	-4.7	/var/lib/liganx/poses/job57_c52_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-5.62|confidence=unknown|strain=high:2.25|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 04:26:08.311575
81	57	52	D835V	-4.7	/var/lib/liganx/poses/job57_c52_D835V.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-5.62|confidence=unknown|strain=high:2.25|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 04:26:18.742452
82	58	53	WT	-4.7	/var/lib/liganx/poses/job58_c53_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-5.62|confidence=unknown|strain=high:2.25|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 04:56:15.267683
83	58	53	D835V	0	\N	mutant_verify_failed: residue A835 (from D835V) not found in receptor (chain A max residue: 49). PDB likely uses different numbering, OR the prep pipeline renumbered residues — check fix_pdb.	2026-04-28 04:56:15.372543
84	59	54	WT	0	/var/lib/liganx/poses/job59_c54_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=0.00|confidence=unknown|strain=high:2.43|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 04:57:27.37411
85	59	54	R132C	0	/var/lib/liganx/poses/job59_c54_R132C.pdbqt	no_foldx_dock_against_wt|engine=pod_gpu|vinardo=0.00|confidence=unknown|strain=high:2.43|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 04:57:36.971936
86	60	55	WT	-4.7	/var/lib/liganx/poses/job60_c55_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-5.62|confidence=unknown|strain=high:2.25|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 05:02:16.353249
87	60	55	D835V	0	\N	mutant_verify_failed: residue A835 (from D835V) not found in receptor (chain A max residue: 49). PDB likely uses different numbering, OR the prep pipeline renumbered residues — check fix_pdb.	2026-04-28 05:02:16.595648
88	61	56	WT	-5.1	/var/lib/liganx/poses/job61_c56_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-5.04|confidence=unknown|strain=mild:1.14|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 05:04:56.526647
89	61	56	D835V	0	\N	mutant_verify_failed: precache=residue A835 (from D835V) not found in receptor (chain A max residue: 49). PDB likely uses different numbering, OR the prep pipeline renumbered residues — check fix_pdb. pdbfixer=residue A835 (from D835V) not found in receptor (chain A max residue: 49). PDB likely uses different numbering, OR the prep pipeline renumbered residues — check fix_pdb.	2026-04-28 05:04:56.630608
90	62	57	WT	-5.1	/var/lib/liganx/poses/job62_c57_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-5.04|confidence=unknown|strain=mild:1.14|posebusters=passed all 0 checks|contacts=PHE928:Hydr:3.6,LYS907:Hydr:4.2,LYS907:HBAc:3.0,LYS907:VdWC:3.0,PHE906:VdWC:2.6|summary=Key contacts: H-bond acceptor + hydrophobic with LYS907; hydrophobic with PHE928; van der Waals with PHE906.	2026-04-28 05:08:46.70997
91	62	57	D835V	0	\N	mutant_verify_failed: residue A835 (from D835V) not found in receptor (chain A max residue: 49). PDB likely uses different numbering, OR the prep pipeline renumbered residues — check fix_pdb.	2026-04-28 05:08:46.810286
92	63	58	WT	-4.7	/var/lib/liganx/poses/job63_c58_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-5.62|confidence=unknown|strain=high:2.25|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 05:19:24.476551
93	63	58	D835V	0	\N	mutant_verify_failed: residue A835 (from D835V) not found in receptor (chain A max residue: 49). PDB likely uses different numbering, OR the prep pipeline renumbered residues — check fix_pdb.	2026-04-28 05:19:24.664984
94	64	59	WT	-4.9	/var/lib/liganx/poses/job64_c59_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-5.21|confidence=unknown|strain=mild:1.59|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 05:22:18.016379
95	64	59	D835V	0	\N	mutant_verify_failed: residue A835 (from D835V) not found in receptor (chain A max residue: 49). PDB likely uses different numbering, OR the prep pipeline renumbered residues — check fix_pdb. | diag=cleaned_pdb_size=174545,clean_max=947_at835=ASP,mut_max=947_at835=VAL,pdbqt_max=49_at835=None	2026-04-28 05:22:18.126383
96	65	60	WT	-7.2	/var/lib/liganx/poses/job65_c60_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-5.28|confidence=unknown|strain=mild:1.81|posebusters=passed all 0 checks|contacts=LEU844:VdWC:2.7,GLY796:VdWC:2.5,CYS797:Hydr:3.8,THR854:VdWC:3.0,THR790:VdWC:2.5|summary=Key contacts: hydrophobic with CYS797; hydrophobic with LYS745; hydrophobic with VAL726; van der Waals with GLY796.	2026-04-28 05:22:20.69241
97	65	60	C797S	0	\N	mutant_verify_failed: residue A797 (from C797S) not found in receptor (chain A max residue: 169). PDB likely uses different numbering, OR the prep pipeline renumbered residues — check fix_pdb. | diag=cleaned_pdb_size=195038,clean_max=1019_at797=CYS,mut_max=1019_at797=SER,pdbqt_max=169_at797=None	2026-04-28 05:22:20.800358
98	66	61	WT	-5.1	/var/lib/liganx/poses/job66_c61_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-5.04|confidence=unknown|strain=mild:1.14|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 05:25:55.593727
99	66	61	D835V	-5.1	/var/lib/liganx/poses/job66_c61_D835V.pdbqt	pdbfixer_mutated|diag=cleaned_pdb_size=174545,clean_max=947_at835=ASP,mut_max=947_at835=VAL,pdbqt_max=49_at835=None|engine=pod_gpu|vinardo=-5.04|confidence=unknown|strain=mild:1.14|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 05:26:06.478623
100	67	62	WT	-7.3	/var/lib/liganx/poses/job67_c62_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-5.86|confidence=unknown|strain=mild:1.69|posebusters=passed all 0 checks|contacts=MET793:VdWC:2.3,THR790:VdWC:2.6,LEU844:VdWC:2.6,MET766:VdWC:2.6,LYS745:Hydr:4.0|summary=Key contacts: hydrophobic with LYS745; van der Waals with LEU788; van der Waals with LEU844; van der Waals with MET766.	2026-04-28 05:27:33.547826
101	67	62	T790M	-8.1	/var/lib/liganx/poses/job67_c62_T790M.pdbqt	pdbfixer_mutated|diag=cleaned_pdb_size=195038,clean_max=1019_at790=THR,mut_max=1019_at790=MET,pdbqt_max=169_at790=None|engine=pod_gpu|vinardo=-6.86|confidence=unknown|strain=mild:1.99|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 05:27:45.247908
102	68	63	WT	-7	/var/lib/liganx/poses/job68_c63_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-5.97|confidence=unknown|strain=mild:1.89|posebusters=passed all 0 checks|contacts=MET793:VdWC:2.6,LYS745:VdWC:2.7,LEU844:Hydr:4.4,CYS797:Hydr:4.4,GLY719:VdWC:2.7|summary=Key contacts: hydrophobic with CYS797; hydrophobic with LEU718; hydrophobic with LEU844; hydrophobic with VAL726.	2026-04-28 05:31:16.454299
103	69	65	WT	-7	/var/lib/liganx/poses/job69_c65_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-5.10|confidence=unknown|strain=mild:1.78|posebusters=passed all 0 checks|contacts=GLY724:HBAc:3.2,GLY724:VdWC:2.4,MET766:VdWC:2.6,LEU747:VdWC:2.8,CYS797:Hydr:4.2|summary=Key contacts: hydrophobic with CYS797; H-bond acceptor with GLY724; hydrophobic with LYS745; van der Waals with LEU747.	2026-04-28 05:31:33.616295
104	68	63	T790M	-8.1	/var/lib/liganx/poses/job68_c63_T790M.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=-7.25|confidence=unknown|strain=high:2.01|posebusters=passed all 0 checks|contacts=ASP855:VdWC:2.9,MET790:Hydr:4.3,LYS745:Hydr:3.9,LYS745:HBAc:3.4,LYS745:VdWC:2.4|summary=Key contacts: H-bond acceptor + hydrophobic with LYS745; hydrophobic with MET790; H-bond acceptor with MET793; van der Waals with ALA743.	2026-04-28 05:31:36.734671
105	69	65	T790M	-7.2	/var/lib/liganx/poses/job69_c65_T790M.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-5.26|confidence=unknown|strain=high:2.06|posebusters=passed all 0 checks|contacts=VAL726:Hydr:4.4,ALA743:VdWC:2.5,LYS745:Hydr:4.3,LYS745:VdWC:2.7,MET793:VdWC:2.7|summary=Key contacts: hydrophobic with LYS745; hydrophobic with MET790; hydrophobic with VAL726; van der Waals with ALA743.	2026-04-28 05:31:54.429902
106	69	65	L858R	-7	/var/lib/liganx/poses/job69_c65_L858R.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=-5.10|confidence=unknown|strain=mild:1.78|posebusters=passed all 0 checks|contacts=MET766:VdWC:2.6,VAL726:VdWC:2.7,GLY724:HBAc:3.2,GLY724:VdWC:2.4,LEU747:VdWC:2.8|summary=Key contacts: hydrophobic with CYS797; H-bond acceptor with GLY724; hydrophobic with LYS745; van der Waals with LEU747.	2026-04-28 05:32:13.75509
107	68	64	WT	-6.8	/var/lib/liganx/poses/job68_c64_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-6.02|confidence=unknown|strain=mild:1.23|posebusters=check_skipped: timeout|contacts=ASP855:HBDo:3.0,ASP855:VdWC:3.0,GLY796:VdWC:2.7,THR790:VdWC:2.8,LYS745:Hydr:4.5|summary=Key contacts: H-bond donor with ASP855; hydrophobic with LYS745; hydrophobic with PHE723; van der Waals with GLY796.	2026-04-28 05:32:49.71401
108	69	66	WT	-6.4	/var/lib/liganx/poses/job69_c66_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-4.98|confidence=unknown|strain=mild:1.32|posebusters=check_skipped: timeout|contacts=THR854:VdWC:2.4,LEU718:Hydr:3.7,LEU718:VdWC:2.6,LYS745:Hydr:3.7,LYS745:VdWC:2.7|summary=Key contacts: hydrophobic with LEU718; hydrophobic with LYS745; H-bond acceptor with MET793; van der Waals with LEU844.	2026-04-28 05:33:26.023796
109	68	64	T790M	-6.5	/var/lib/liganx/poses/job68_c64_T790M.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=-6.33|confidence=unknown|strain=mild:1.62|posebusters=check_skipped: timeout|prolif=empty|summary=No interaction data.	2026-04-28 05:33:59.911627
110	69	66	T790M	-6.3	/var/lib/liganx/poses/job69_c66_T790M.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-5.35|confidence=unknown|strain=mild:1.44|posebusters=check_skipped: timeout|contacts=LEU844:VdWC:2.5,LYS745:HBAc:3.2,LYS745:VdWC:2.3,LEU718:VdWC:2.6|summary=Key contacts: H-bond acceptor with LYS745; van der Waals with LEU718; van der Waals with LEU844.	2026-04-28 05:34:33.777572
111	69	66	L858R	-6.4	/var/lib/liganx/poses/job69_c66_L858R.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=-4.98|confidence=medium|strain=mild:1.32|posebusters=failed: internal_energy|contacts=THR854:VdWC:2.4,LEU844:VdWC:2.6,MET766:VdWC:2.7,LYS745:Hydr:3.7,LYS745:VdWC:2.7|summary=Medium-confidence pose (a few posebusters checks failed) Key contacts: hydrophobic with LEU718; hydrophobic with LYS745; H-bond acceptor with MET793; van der Waals with LEU844.	2026-04-28 05:35:35.344373
112	70	67	WT	-7.7	/var/lib/liganx/poses/job70_c67_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-7.10|confidence=unknown|strain=mild:1.39|posebusters=passed all 0 checks|contacts=LEU788:VdWC:2.2,LYS745:Hydr:3.9,LYS745:VdWC:2.8,LEU792:VdWC:2.8,GLY796:VdWC:2.8|summary=Key contacts: hydrophobic with LYS745; H-bond acceptor with MET793; hydrophobic with VAL726; van der Waals with GLY796.	2026-04-28 05:40:03.819885
113	77	74	WT	-9	/var/lib/liganx/poses/job77_c74_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-8.55|confidence=unknown|strain=ok:0.78|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 05:40:49.399988
114	73	70	WT	-4.2	/var/lib/liganx/poses/job73_c70_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-3.87|confidence=unknown|strain=mild:1.58|posebusters=passed all 0 checks|contacts=LEU445:Hydr:4.4,LEU445:VdWC:2.1,ASP391:Hydr:4.3,ASP391:VdWC:2.6,GLY390:VdWC:2.6|summary=Key contacts: hydrophobic with ASP391; hydrophobic with ASP444; hydrophobic with LEU445; van der Waals with GLY390.	2026-04-28 05:40:50.543916
115	72	69	WT	0	/var/lib/liganx/poses/job72_c69_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=0.00|confidence=unknown|strain=mild:1.82|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 05:40:53.560042
116	70	67	T790M	-7.2	/var/lib/liganx/poses/job70_c67_T790M.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-4.72|confidence=unknown|strain=mild:1.18|posebusters=passed all 0 checks|contacts=MET766:VdWC:2.7,LEU718:VdWC:2.8,GLY796:VdWC:2.5,LEU788:VdWC:2.6,CYS797:Hydr:4.3|summary=Key contacts: hydrophobic with CYS797; H-bond acceptor + hydrophobic with LYS745; van der Waals with GLY796; van der Waals with LEU718.	2026-04-28 05:41:00.143956
117	74	71	WT	-5.2	/var/lib/liganx/poses/job74_c71_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-6.14|confidence=unknown|strain=high:2.21|posebusters=check_skipped: timeout|contacts=LEU790:Hydr:4.5,LEU790:VdWC:2.7,LEU768:Hydr:4.3,LEU768:VdWC:2.8,ILE714:VdWC:2.6|summary=Key contacts: hydrophobic with LEU712; hydrophobic with LEU768; hydrophobic with LEU790; hydrophobic + π-stacking with TYR772.	2026-04-28 05:41:36.404181
118	76	73	WT	-7.8	/var/lib/liganx/poses/job76_c73_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-6.75|confidence=unknown|strain=mild:1.27|posebusters=check_skipped: timeout|contacts=ASP2033:Hydr:4.2,MET2029:Hydr:4.0,MET2029:VdWC:2.6,LEU2086:VdWC:2.8,GLY2101:VdWC:3.2|summary=Key contacts: hydrophobic with ASP2033; hydrophobic with MET2029; van der Waals with ARG2083; van der Waals with GLY2101.	2026-04-28 05:41:40.092064
119	77	74	Y1230H	-9.1	/var/lib/liganx/poses/job77_c74_Y1230H.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=-6.42|confidence=unknown|strain=mild:1.16|posebusters=passed all 0 checks|contacts=ALA1226:VdWC:2.5,ASN1167:Hydr:3.5,TYR1159:Hydr:4.2,TYR1159:PiSt:6.0,TYR1159:VdWC:2.8|summary=Key contacts: hydrophobic with ASN1167; H-bond acceptor with ASP1222; hydrophobic with ILE1084; hydrophobic with LEU1140.	2026-04-28 05:41:44.260178
120	73	70	T315I	-4.2	/var/lib/liganx/poses/job73_c70_T315I.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=-3.87|confidence=unknown|strain=mild:1.58|posebusters=passed all 0 checks|contacts=LEU445:Hydr:4.4,LEU445:VdWC:2.1,GLY390:VdWC:2.6,GLY442:VdWC:2.7,ASP391:Hydr:4.3|summary=Key contacts: hydrophobic with ASP391; hydrophobic with ASP444; hydrophobic with LEU445; van der Waals with GLY390.	2026-04-28 05:41:52.060225
155	101	98	H1047R	-8.1	/var/lib/liganx/poses/job101_c98_H1047R.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-6.37|confidence=unknown|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 05:53:59.68992
121	80	77	WT	-7.1	/var/lib/liganx/poses/job80_c77_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-6.08|confidence=unknown|strain=mild:1.36|posebusters=passed all 0 checks|contacts=VAL726:VdWC:3.2,MET793:VdWC:2.6,THR854:HBAc:3.5,THR854:VdWC:3.1,LYS745:Hydr:4.2|summary=Key contacts: H-bond acceptor with ASP855; H-bond acceptor + hydrophobic with LYS745; H-bond acceptor with THR854; van der Waals with CYS797.	2026-04-28 05:42:06.800519
125	80	77	T790M	-7.1	/var/lib/liganx/poses/job80_c77_T790M.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-6.02|confidence=unknown|strain=mild:1.3|posebusters=passed all 0 checks|contacts=MET793:HBAc:3.4,MET793:VdWC:3.1,LYS745:Hydr:3.5,LYS745:HBAc:3.1,LYS745:VdWC:2.6|summary=Key contacts: H-bond acceptor + hydrophobic with LYS745; H-bond acceptor with MET793; van der Waals with ASP855; van der Waals with LEU718.	2026-04-28 05:43:16.08431
147	96	93	WT	-7.9	/var/lib/liganx/poses/job96_c93_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-6.99|confidence=unknown|strain=ok:0.87|posebusters=check_skipped: timeout|contacts=LEU2010:VdWC:2.6,GLY2101:VdWC:3.0,ASP2033:Hydr:4.3,ASP2033:VdWC:2.8,VAL1959:VdWC:3.2|summary=Key contacts: hydrophobic with ASP2033; hydrophobic with MET2029; van der Waals with ARG2083; van der Waals with GLY2101.	2026-04-28 05:47:38.87366
122	72	69	R132H	0	/var/lib/liganx/poses/job72_c69_R132H.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=0.00|confidence=unknown|strain=mild:1.82|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 05:42:16.060153
123	75	72	WT	-7.9	/var/lib/liganx/poses/job75_c72_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-6.54|confidence=unknown|strain=mild:1.2|posebusters=check_skipped: timeout|contacts=VAL1130:VdWC:2.6,MET1199:HBAc:3.1,MET1199:VdWC:2.7,LEU1122:Hydr:4.2,LEU1256:VdWC:2.6|summary=Key contacts: H-bond donor with GLU1197; hydrophobic with LEU1122; H-bond acceptor with MET1199; van der Waals with ASP1203.	2026-04-28 05:43:00.273431
126	84	81	WT	-7.4	/var/lib/liganx/poses/job84_c81_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-5.97|confidence=unknown|strain=mild:1.86|posebusters=passed all 0 checks|contacts=LYS745:Hydr:4.0,LYS745:HBAc:2.9,LYS745:VdWC:3.1,MET793:HBAc:3.3,MET793:VdWC:2.3|summary=Key contacts: hydrophobic with LEU844; H-bond acceptor + hydrophobic with LYS745; H-bond acceptor with MET793; van der Waals with ALA743.	2026-04-28 05:43:33.940336
132	84	81	T790M	-7.8	/var/lib/liganx/poses/job84_c81_T790M.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-7.01|confidence=unknown|strain=high:2.11|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 05:44:25.836458
134	75	72	L1196M	-7.8	/var/lib/liganx/poses/job75_c72_L1196M.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=-6.36|confidence=unknown|strain=mild:1.17|posebusters=check_skipped: timeout|contacts=MET1196:VdWC:2.9,LEU1256:VdWC:2.7,ASP1203:VdWC:2.7,VAL1130:VdWC:2.7,GLU1197:HBDo:3.3|summary=Key contacts: H-bond donor with GLU1197; hydrophobic with LEU1122; H-bond acceptor with MET1199; van der Waals with ASP1203.	2026-04-28 05:44:45.852535
124	82	79	WT	-3.8	/var/lib/liganx/poses/job82_c79_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-3.15|confidence=unknown|strain=high:2.27|posebusters=passed all 0 checks|contacts=ASP444:Hydr:3.7,ASP391:Hydr:3.8,ASP391:HBDo:3.0,ASP391:VdWC:3.0,LEU445:Hydr:4.4|summary=Key contacts: H-bond donor + hydrophobic with ASP391; hydrophobic with ASP444; hydrophobic with LEU445.	2026-04-28 05:43:09.344247
130	82	79	T315I	-3.8	/var/lib/liganx/poses/job82_c79_T315I.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-3.15|confidence=unknown|strain=high:2.27|posebusters=passed all 0 checks|contacts=ASP444:Hydr:3.7,ASP391:Hydr:3.8,ASP391:HBDo:3.0,ASP391:VdWC:3.0,LEU445:Hydr:4.4|summary=Key contacts: H-bond donor + hydrophobic with ASP391; hydrophobic with ASP444; hydrophobic with LEU445.	2026-04-28 05:44:11.45247
141	92	89	WT	-5.9	/var/lib/liganx/poses/job92_c89_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-4.75|confidence=unknown|strain=mild:1.28|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 05:46:22.308649
146	92	89	F691L	-5.9	/var/lib/liganx/poses/job92_c89_F691L.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=-4.75|confidence=unknown|strain=mild:1.28|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 05:47:38.856946
127	76	73	G2032R	-5.9	/var/lib/liganx/poses/job76_c73_G2032R.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=-5.17|confidence=unknown|strain=high:2.18|posebusters=check_skipped: timeout|contacts=ARG2032:Hydr:3.7,ARG2032:VdWC:2.7,LYS2090:Hydr:4.2,LYS2090:VdWC:2.8,GLY2031:HBDo:3.4|summary=Key contacts: hydrophobic with ARG2032; hydrophobic with GLU2030; H-bond donor with GLY2031; hydrophobic with LYS2090.	2026-04-28 05:43:35.1789
133	87	84	WT	-7.1	/var/lib/liganx/poses/job87_c84_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-5.53|confidence=unknown|strain=mild:1.11|posebusters=passed all 0 checks|contacts=CYS797:Hydr:3.9,ALA743:VdWC:2.7,MET793:VdWC:3.3,THR854:VdWC:3.1,LYS745:Hydr:4.4|summary=Key contacts: hydrophobic with CYS797; hydrophobic with LYS745; hydrophobic with VAL726; van der Waals with ALA743.	2026-04-28 05:44:39.008418
136	87	84	T790M	-7.2	/var/lib/liganx/poses/job87_c84_T790M.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-5.74|confidence=unknown|strain=mild:1.55|posebusters=passed all 0 checks|contacts=VAL726:VdWC:2.6,GLY796:VdWC:2.5,ASP855:VdWC:2.6,ALA743:VdWC:3.1,LEU718:VdWC:2.6|summary=Key contacts: hydrophobic with LYS745; hydrophobic with MET790; van der Waals with ALA743; van der Waals with ASP855.	2026-04-28 05:45:38.748669
128	74	71	L755S	-5.1	/var/lib/liganx/poses/job74_c71_L755S.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=-5.92|confidence=unknown|strain=high:2.2|posebusters=check_skipped: timeout|contacts=LEU768:Hydr:4.4,LEU768:VdWC:2.7,TYR772:Hydr:4.2,TYR772:PiSt:5.3,TYR772:VdWC:2.7|summary=Key contacts: hydrophobic with LEU712; hydrophobic with LEU768; hydrophobic with LEU790; hydrophobic + π-stacking with TYR772.	2026-04-28 05:43:37.688432
129	83	80	WT	-5	/var/lib/liganx/poses/job83_c80_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-4.89|confidence=unknown|strain=mild:1.67|posebusters=check_skipped: timeout|contacts=LYS716:Hydr:4.3,TYR772:VdWC:2.7,LEU712:VdWC:2.8,ARG713:VdWC:2.2,ILE714:Hydr:3.7|summary=Key contacts: hydrophobic with ILE714; hydrophobic with LYS716; van der Waals with ARG713; van der Waals with LEU712.	2026-04-28 05:43:58.196295
131	86	83	WT	-7.3	/var/lib/liganx/poses/job86_c83_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-6.12|confidence=unknown|strain=mild:1.49|posebusters=passed all 0 checks|contacts=THR790:VdWC:2.6,LEU792:VdWC:2.6,LEU788:VdWC:2.3,VAL726:VdWC:2.6,LYS745:Hydr:4.0|summary=Key contacts: hydrophobic with LEU718; hydrophobic with LYS745; H-bond acceptor with MET793; van der Waals with LEU788.	2026-04-28 05:44:22.636717
135	86	83	T790M	-7.2	/var/lib/liganx/poses/job86_c83_T790M.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-5.65|confidence=unknown|strain=mild:1.4|posebusters=passed all 0 checks|contacts=LEU788:VdWC:3.4,ASP855:VdWC:2.4,MET793:HBAc:3.1,MET793:VdWC:2.3,ALA743:VdWC:2.4|summary=Key contacts: hydrophobic with LYS745; hydrophobic with MET790; H-bond acceptor with MET793; van der Waals with ALA743.	2026-04-28 05:45:21.964747
137	88	85	WT	-4.4	/var/lib/liganx/poses/job88_c85_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-3.64|confidence=unknown|strain=mild:1.36|posebusters=check_skipped: timeout|contacts=GLN22:HBAc:3.0,GLN22:VdWC:3.0,LYS147:VdWC:2.4,HIS27:Hydr:4.2,HIS27:VdWC:2.4|summary=Key contacts: H-bond acceptor with GLN22; hydrophobic with HIS27; hydrophobic with PHE28; van der Waals with LYS147.	2026-04-28 05:45:41.29392
139	83	80	L755S	-5	/var/lib/liganx/poses/job83_c80_L755S.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-4.89|confidence=unknown|strain=mild:1.67|posebusters=check_skipped: timeout|contacts=TYR772:VdWC:2.7,ARG713:VdWC:2.2,ILE714:Hydr:3.7,ILE714:VdWC:2.7,LEU712:VdWC:2.8|summary=Key contacts: hydrophobic with ILE714; hydrophobic with LYS716; van der Waals with ARG713; van der Waals with LEU712.	2026-04-28 05:45:53.304774
145	88	85	G12C	-4.7	/var/lib/liganx/poses/job88_c85_G12C.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=-3.95|confidence=unknown|strain=mild:1.29|posebusters=check_skipped: timeout|contacts=GLN22:HBAc:3.1,GLN22:VdWC:2.5,PHE28:Hydr:4.4,PHE28:VdWC:2.8,LYS147:Hydr:3.8|summary=Key contacts: H-bond acceptor with GLN22; hydrophobic with LYS147; hydrophobic with PHE28; van der Waals with THR148.	2026-04-28 05:47:25.398304
151	96	93	G2032R	-6.3	/var/lib/liganx/poses/job96_c93_G2032R.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-4.92|confidence=unknown|strain=mild:1.14|posebusters=check_skipped: timeout|contacts=ARG2032:Hydr:3.4,ARG2032:VdWC:2.7,LEU1951:Hydr:4.5,LEU1951:VdWC:2.7,VAL1959:VdWC:3.2|summary=Key contacts: hydrophobic with ARG2032; hydrophobic with LEU1951; van der Waals with LEU2028; van der Waals with LEU2086.	2026-04-28 05:49:28.953766
152	100	97	WT	-8.3	/var/lib/liganx/poses/job100_c97_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-6.52|confidence=unknown|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 05:51:14.023385
138	90	87	WT	-11.5	/var/lib/liganx/poses/job90_c87_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-9.75|confidence=unknown|strain=mild:1.61|posebusters=passed all 0 checks|contacts=VAL668:Hydr:4.4,LEU595:Hydr:4.4,LEU595:VdWC:2.7,LEU799:Hydr:4.3,LEU799:VdWC:3.2|summary=Key contacts: hydrophobic with ASP810; hydrophobic with CYS809; hydrophobic with GLU640; hydrophobic with LEU595.	2026-04-28 05:45:49.488592
140	93	90	WT	-0.1	/var/lib/liganx/poses/job93_c90_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-0.01|confidence=unknown|strain=mild:1.57|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 05:46:21.844694
142	97	94	WT	-9.2	/var/lib/liganx/poses/job97_c94_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-8.65|confidence=unknown|strain=ok:0.63|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 05:46:59.644856
143	90	87	T670I	-11.7	/var/lib/liganx/poses/job90_c87_T670I.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=-11.21|confidence=unknown|strain=mild:1.62|posebusters=passed all 0 checks|contacts=VAL603:Hydr:4.4,VAL603:VdWC:2.8,GLU640:Hydr:3.8,GLU640:VdWC:3.1,TYR672:Hydr:4.3|summary=Key contacts: H-bond acceptor + hydrophobic with ASP810; hydrophobic with CYS673; hydrophobic with GLU640; hydrophobic with ILE670.	2026-04-28 05:47:06.862255
144	95	92	WT	-8	/var/lib/liganx/poses/job95_c92_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-6.70|confidence=unknown|strain=ok:0.93|posebusters=check_skipped: timeout|contacts=GLY1202:VdWC:2.7,LYS1150:VdWC:2.6,MET1199:HBAc:3.3,MET1199:VdWC:2.4,GLU1197:HBDo:3.1|summary=Key contacts: H-bond donor with GLU1197; H-bond acceptor with MET1199; van der Waals with GLY1202; van der Waals with LEU1196.	2026-04-28 05:47:18.666666
148	93	90	R132H	-0.1	/var/lib/liganx/poses/job93_c90_R132H.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-0.01|confidence=unknown|strain=mild:1.57|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 05:47:49.857039
149	97	94	Y1230H	-8.4	/var/lib/liganx/poses/job97_c94_Y1230H.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-6.77|confidence=unknown|strain=ok:0.8|posebusters=passed all 0 checks|contacts=ARG1208:HBDo:3.4,ARG1208:VdWC:2.4,MET1211:Hydr:4.1,ASP1222:VdWC:2.4,HIS1230:VdWC:2.6|summary=Key contacts: H-bond donor with ARG1208; H-bond donor + hydrophobic with ASN1167; hydrophobic with MET1211; hydrophobic with VAL1092.	2026-04-28 05:48:02.141083
150	95	92	L1196M	-8.1	/var/lib/liganx/poses/job95_c92_L1196M.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-6.54|confidence=unknown|strain=ok:0.99|posebusters=check_skipped: timeout|contacts=GLU1197:HBDo:3.2,GLU1197:VdWC:2.4,MET1199:HBAc:3.3,MET1199:VdWC:2.3,LYS1150:VdWC:2.6|summary=Key contacts: H-bond donor with GLU1197; hydrophobic with LEU1122; H-bond acceptor with MET1199; van der Waals with LEU1256.	2026-04-28 05:49:08.357137
153	100	97	H1047R	-8.3	/var/lib/liganx/poses/job100_c97_H1047R.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=-6.52|confidence=unknown|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 05:52:32.4497
154	101	98	WT	-8.1	/var/lib/liganx/poses/job101_c98_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-6.37|confidence=unknown|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 05:52:44.915845
156	103	100	WT	-11.1	/var/lib/liganx/poses/job103_c100_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-11.50|confidence=unknown|strain=mild:1.62|posebusters=passed all 0 checks|contacts=MET318:HBAc:3.0,MET318:VdWC:2.8,TYR253:Hydr:4.1,ILE313:Hydr:4.4,PHE382:Hydr:4.2|summary=Key contacts: hydrophobic with ASP381; H-bond donor + hydrophobic with GLU286; hydrophobic with ILE313; hydrophobic with LYS271.	2026-04-28 05:57:07.266941
157	104	101	WT	-7.8	/var/lib/liganx/poses/job104_c101_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-2.84|confidence=unknown|strain=mild:1.5|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 05:57:09.515525
158	103	100	T315I	-11.6	/var/lib/liganx/poses/job103_c100_T315I.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=-12.10|confidence=unknown|strain=mild:1.79|posebusters=passed all 0 checks|contacts=LEU354:VdWC:2.8,VAL256:VdWC:3.4,MET318:Hydr:4.3,MET318:VdWC:3.2,ILE315:Hydr:4.0|summary=Key contacts: hydrophobic with ASP381; hydrophobic with ILE315; hydrophobic with LYS271; hydrophobic with MET290.	2026-04-28 05:57:56.807551
159	104	101	F691L	-7.2	/var/lib/liganx/poses/job104_c101_F691L.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=-3.18|confidence=unknown|strain=mild:1.49|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 05:58:00.479518
160	107	104	WT	-7.7	/var/lib/liganx/poses/job107_c104_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-5.85|confidence=unknown|strain=mild:1.08|posebusters=check_skipped: timeout|contacts=VAL29:VdWC:3.2,LYS16:HBAc:3.2,LYS16:VdWC:2.4,ALA18:VdWC:2.7,ASP30:VdWC:3.0|summary=Key contacts: H-bond acceptor with LYS16; hydrophobic + π-stacking with PHE28; van der Waals with ALA18; van der Waals with ASP30.	2026-04-28 05:58:04.39778
161	107	104	G12C	-8.8	/var/lib/liganx/poses/job107_c104_G12C.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=-6.81|confidence=unknown|strain=mild:1.88|posebusters=check_skipped: timeout|contacts=LYS117:VdWC:2.3,ALA18:VdWC:2.7,LEU120:VdWC:3.0,LYS16:VdWC:2.9,PHE28:Hydr:3.9|summary=Key contacts: H-bond donor with ASP30; hydrophobic + π-stacking with PHE28; H-bond acceptor with SER17; van der Waals with ALA18.	2026-04-28 05:59:31.203857
162	108	105	WT	-5.6	/var/lib/liganx/poses/job108_c105_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-4.66|confidence=unknown|strain=mild:1.42|posebusters=passed all 0 checks|contacts=ILE76:VdWC:3.3,THR77:HBAc:3.3,THR77:VdWC:2.3,THR19:VdWC:3.2,ARG82:VdWC:2.5|summary=Key contacts: H-bond acceptor with THR77; van der Waals with ALA74; van der Waals with ARG82; van der Waals with ASN96.	2026-04-28 06:05:00.948041
163	111	108	WT	-7.9	/var/lib/liganx/poses/job111_c108_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-5.78|confidence=unknown|strain=mild:1.11|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 06:05:16.467864
164	109	106	WT	-10	/var/lib/liganx/poses/job109_c106_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-9.36|confidence=unknown|strain=ok:0.82|posebusters=check_skipped: timeout|contacts=GLY596:HBAc:2.8,GLY596:VdWC:2.8,LEU514:VdWC:2.8,ASP594:HBDo:3.4,ASP594:HBAc:3.2|summary=Key contacts: H-bond acceptor + H-bond donor with ASP594; H-bond acceptor with GLY596; hydrophobic with ILE527; hydrophobic with LYS483.	2026-04-28 06:05:43.352425
165	108	105	R132H	-4.5	/var/lib/liganx/poses/job108_c105_R132H.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=-3.41|confidence=unknown|strain=mild:1.63|posebusters=passed all 0 checks|contacts=THR19:VdWC:2.9,ALA74:VdWC:3.4,ILE76:Hydr:4.2,ILE76:VdWC:3.2,ASP16:Hydr:4.2|summary=Key contacts: hydrophobic with ASP16; hydrophobic with ILE76; van der Waals with ALA74; van der Waals with THR19.	2026-04-28 06:05:47.704583
166	113	110	WT	-7.6	/var/lib/liganx/poses/job113_c110_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-5.32|confidence=unknown|strain=mild:1.71|posebusters=check_skipped: timeout|contacts=GLY13:VdWC:2.9,LYS117:Hydr:4.3,LYS117:VdWC:3.3,GLY15:VdWC:2.8,GLU31:VdWC:3.0|summary=Key contacts: H-bond donor with ASP30; hydrophobic with LYS117; hydrophobic with PHE28; H-bond acceptor with SER17.	2026-04-28 06:05:55.882665
167	111	108	F691L	-7.8	/var/lib/liganx/poses/job111_c108_F691L.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=-5.15|confidence=unknown|strain=mild:1.33|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 06:06:00.988756
168	112	109	WT	-8.5	/var/lib/liganx/poses/job112_c109_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-8.12|confidence=unknown|strain=mild:1.83|posebusters=check_skipped: timeout|contacts=ILE767:VdWC:3.1,VAL734:VdWC:2.8,ASP863:Hydr:4.4,ASP863:VdWC:2.9,PHE864:Hydr:4.2|summary=Key contacts: hydrophobic with ASP863; hydrophobic with CYS805; hydrophobic with GLU770; H-bond donor with GLY865.	2026-04-28 06:06:02.748393
169	109	106	V600E	-9.9	/var/lib/liganx/poses/job109_c106_V600E.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=-9.80|confidence=unknown|strain=ok:0.96|posebusters=check_skipped: timeout|contacts=TRP531:Hydr:4.5,GLN530:HBDo:3.4,GLN530:VdWC:2.5,PHE583:Hydr:4.5,PHE583:PiSt:4.2|summary=Key contacts: H-bond donor with ASP594; H-bond donor with GLN530; H-bond acceptor with GLY596; H-bond acceptor + hydrophobic with LYS483.	2026-04-28 06:07:09.91776
170	113	110	G12C	-8	/var/lib/liganx/poses/job113_c110_G12C.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=-5.93|confidence=unknown|strain=mild:1.75|posebusters=check_skipped: timeout|contacts=PRO34:VdWC:2.8,GLY13:VdWC:2.9,ASP30:HBDo:3.0,ASP30:VdWC:3.0,GLY15:VdWC:2.7|summary=Key contacts: H-bond donor with ASP30; hydrophobic with LYS117; hydrophobic with PHE28; H-bond acceptor with SER17.	2026-04-28 06:07:18.170193
171	112	109	L755S	-8.6	/var/lib/liganx/poses/job112_c109_L755S.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=-7.43|confidence=unknown|strain=mild:1.95|posebusters=check_skipped: timeout|contacts=PHE864:VdWC:2.8,LYS753:Hydr:4.4,LEU807:Hydr:4.2,LEU807:VdWC:2.8,SER783:VdWC:2.7|summary=Key contacts: hydrophobic with ARG849; hydrophobic with ASP863; hydrophobic with LEU807; hydrophobic with LEU852.	2026-04-28 06:07:28.38099
172	114	111	WT	-6.9	/var/lib/liganx/poses/job114_c111_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-5.86|confidence=unknown|strain=high:2.09|posebusters=passed all 0 checks|contacts=HIS309:Hydr:3.4,HIS309:VdWC:2.4,VAL312:Hydr:4.4,VAL312:VdWC:2.5,LEU288:Hydr:4.0|summary=Key contacts: H-bond acceptor with GLY310; hydrophobic with HIS309; hydrophobic with LEU288; H-bond acceptor with THR313.	2026-04-28 06:10:30.122494
173	117	114	WT	-6.9	/var/lib/liganx/poses/job117_c114_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-2.70|confidence=unknown|strain=mild:1.49|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 06:10:40.739639
174	118	115	WT	-8.5	/var/lib/liganx/poses/job118_c115_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-6.60|confidence=unknown|strain=mild:1.81|posebusters=check_skipped: timeout|contacts=MET801:Hydr:4.4,MET801:HBAc:3.5,MET801:VdWC:2.6,ARG849:Hydr:3.9,ARG849:VdWC:2.5|summary=Key contacts: hydrophobic with ARG849; hydrophobic with CYS805; hydrophobic with LEU726; hydrophobic with LEU852.	2026-04-28 06:11:27.899745
175	114	111	R132H	-7	/var/lib/liganx/poses/job114_c111_R132H.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=-5.78|confidence=unknown|strain=high:2.17|posebusters=passed all 0 checks|contacts=THR313:HBAc:3.1,THR313:VdWC:2.7,HIS309:Hydr:3.5,HIS309:VdWC:2.4,LEU288:Hydr:4.2|summary=Key contacts: H-bond acceptor with GLY310; hydrophobic with HIS309; hydrophobic with LEU288; H-bond acceptor with THR313.	2026-04-28 06:11:35.141461
176	117	114	F691L	-6.6	/var/lib/liganx/poses/job117_c114_F691L.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=-2.27|confidence=unknown|strain=mild:1.4|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 06:11:35.85514
177	115	112	WT	-10.8	/var/lib/liganx/poses/job115_c112_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-11.39|confidence=unknown|strain=mild:1.15|posebusters=check_skipped: timeout|contacts=LEU514:VdWC:3.3,GLY596:HBAc:2.8,GLY596:VdWC:2.8,CYS532:HBAc:3.1,CYS532:VdWC:2.2|summary=Key contacts: H-bond acceptor + H-bond donor with ASP594; H-bond acceptor with CYS532; H-bond donor with GLN530; H-bond acceptor with GLY596.	2026-04-28 06:11:37.695115
178	117	114	D835V	-6.6	/var/lib/liganx/poses/job117_c114_D835V.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=-2.54|confidence=unknown|strain=mild:1.34|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 06:12:32.919534
179	120	117	WT	-11.3	/var/lib/liganx/poses/job120_c117_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-11.43|confidence=unknown|strain=mild:1.51|posebusters=passed all 0 checks|contacts=MET290:Hydr:3.6,MET290:VdWC:3.3,PHE382:Hydr:4.3,PHE382:VdWC:3.4,VAL299:VdWC:3.2|summary=Key contacts: hydrophobic with ASP381; H-bond donor + hydrophobic with GLU286; hydrophobic with ILE313; hydrophobic with LYS271.	2026-04-28 06:14:54.765672
180	120	117	T315I	-10	/var/lib/liganx/poses/job120_c117_T315I.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=-7.84|confidence=unknown|strain=high:2.47|posebusters=passed all 0 checks|contacts=GLU282:Hydr:4.4,ASP381:Hydr:4.2,ASP381:VdWC:2.7,MET290:Hydr:4.3,VAL289:VdWC:2.4|summary=Key contacts: hydrophobic with ASP381; hydrophobic with GLU282; hydrophobic with GLU286; hydrophobic with ILE315.	2026-04-28 06:15:07.945494
181	121	118	WT	-8.7	/var/lib/liganx/poses/job121_c118_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-9.03|confidence=unknown|strain=ok:0.89|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 06:25:05.402739
182	121	118	D835Y	-8.7	/var/lib/liganx/poses/job121_c118_D835Y.pdbqt	pdbfixer_mutated|mutation_outside_pocket=14.0A|engine=pod_gpu|vinardo=-9.06|confidence=unknown|strain=mild:1.16|posebusters=passed all 0 checks|contacts=PHE830:Hydr:4.1,PHE830:VdWC:2.5,PHE691:Hydr:4.3,PHE691:VdWC:3.1,LEU616:Hydr:4.0|summary=Key contacts: hydrophobic with LEU616; hydrophobic with LYS644; hydrophobic with PHE691; hydrophobic with PHE830.	2026-04-28 06:25:16.366432
183	121	119	WT	-7.2	/var/lib/liganx/poses/job121_c119_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-7.50|confidence=unknown|strain=mild:1.12|posebusters=check_skipped: timeout|prolif=empty|summary=No interaction data.	2026-04-28 06:26:26.3714
184	121	119	D835Y	-7.2	/var/lib/liganx/poses/job121_c119_D835Y.pdbqt	pdbfixer_mutated|mutation_outside_pocket=14.0A|engine=pod_gpu|vinardo=-7.67|confidence=medium|strain=ok:0.8|posebusters=failed: internal_energy|contacts=CYS694:VdWC:2.6,CYS828:Hydr:4.1,CYS828:VdWC:2.7,VAL624:Hydr:3.9,VAL624:VdWC:2.9|summary=Medium-confidence pose (a few posebusters checks failed) Key contacts: hydrophobic with CYS828; hydrophobic with LEU616; hydrophobic with LYS644; hydrophobic with PHE691.	2026-04-28 06:27:32.104237
185	122	120	WT	-8.7	/var/lib/liganx/poses/job122_c120_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-9.03|confidence=unknown|strain=ok:0.89|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 06:31:01.291341
186	122	120	D835Y	-8.7	/var/lib/liganx/poses/job122_c120_D835Y.pdbqt	pdbfixer_mutated|mutation_outside_pocket=14.0A|engine=pod_gpu|vinardo=-9.06|confidence=unknown|strain=mild:1.16|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 06:31:12.04393
187	123	121	WT	-8.2	/var/lib/liganx/poses/job123_c121_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-7.08|confidence=unknown|strain=mild:1.18|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 06:31:29.928429
188	123	121	D835Y	-8.3	/var/lib/liganx/poses/job123_c121_D835Y.pdbqt	foldx_precached|mutation_outside_pocket=14.0A|engine=pod_gpu|vinardo=-8.86|confidence=unknown|strain=ok:0.75|posebusters=passed all 0 checks|contacts=ALA642:VdWC:3.3,PHE830:Hydr:4.3,PHE830:VdWC:2.4,CYS694:HBAc:3.4,CYS694:VdWC:2.5|summary=Key contacts: H-bond acceptor with CYS694; hydrophobic with CYS828; hydrophobic with LEU616; hydrophobic with LYS644.	2026-04-28 06:31:47.047214
189	125	123	WT	-11.3	/var/lib/liganx/poses/job125_c123_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-11.43|confidence=unknown|strain=mild:1.51|posebusters=passed all 0 checks|contacts=MET318:VdWC:2.5,ASP381:Hydr:3.8,GLY321:VdWC:2.8,VAL299:VdWC:3.2,HIS361:VdWC:3.2|summary=Key contacts: hydrophobic with ASP381; H-bond donor + hydrophobic with GLU286; hydrophobic with ILE313; hydrophobic with LYS271.	2026-04-28 06:41:04.782477
190	125	123	T315I	-10	/var/lib/liganx/poses/job125_c123_T315I.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=-7.84|confidence=unknown|strain=high:2.47|posebusters=passed all 0 checks|contacts=LEU370:VdWC:2.9,ALA380:VdWC:2.5,VAL289:VdWC:2.4,MET290:Hydr:4.3,LEU248:VdWC:3.4|summary=Key contacts: hydrophobic with ASP381; hydrophobic with GLU282; hydrophobic with GLU286; hydrophobic with ILE315.	2026-04-28 06:41:18.382089
191	126	124	WT	-11.9	/var/lib/liganx/poses/job126_c124_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-12.48|confidence=unknown|strain=mild:1.52|posebusters=passed all 0 checks|contacts=ILE313:Hydr:4.0,TYR253:Hydr:3.9,TYR253:VdWC:3.4,LEU248:VdWC:2.6,VAL256:VdWC:3.4|summary=Key contacts: hydrophobic with ASP381; H-bond donor + hydrophobic with GLU286; hydrophobic with ILE313; hydrophobic with LYS271.	2026-04-28 06:42:13.1108
192	126	124	T315I	-10.7	/var/lib/liganx/poses/job126_c124_T315I.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-10.79|confidence=unknown|strain=mild:1.44|posebusters=passed all 0 checks|contacts=ILE315:Hydr:4.4,ILE315:VdWC:2.8,GLY321:VdWC:2.7,GLU316:VdWC:2.9,LYS271:Hydr:3.8|summary=Key contacts: hydrophobic with ASP381; hydrophobic with GLU286; hydrophobic with ILE313; hydrophobic with ILE315.	2026-04-28 06:42:25.213886
193	126	124	E255K	-11.9	/var/lib/liganx/poses/job126_c124_E255K.pdbqt	pdbfixer_mutated|mutation_outside_pocket=12.0A|engine=pod_gpu|vinardo=-12.48|confidence=unknown|strain=mild:1.52|posebusters=passed all 0 checks|contacts=PHE382:Hydr:4.3,ASP381:Hydr:3.7,ASP381:VdWC:2.7,LEU248:VdWC:2.6,GLY321:VdWC:2.8|summary=Key contacts: hydrophobic with ASP381; H-bond donor + hydrophobic with GLU286; hydrophobic with ILE313; hydrophobic with LYS271.	2026-04-28 06:42:38.034235
194	126	124	Y253H	-10.4	/var/lib/liganx/poses/job126_c124_Y253H.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=-9.78|confidence=unknown|strain=mild:1.48|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 06:42:48.994275
195	126	125	WT	-8.6	/var/lib/liganx/poses/job126_c125_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-7.78|confidence=high|strain=mild:1.46|posebusters=passed all 20 checks|contacts=LEU370:Hydr:4.4,LEU370:VdWC:2.1,MET290:Hydr:4.3,VAL299:VdWC:3.2,GLU286:Hydr:4.2|summary=High-confidence pose (no posebusters checks failed) Key contacts: hydrophobic with ASP381; H-bond donor + hydrophobic with GLU286; hydrophobic with LEU248; hydrophobic with LEU370.	2026-04-28 06:43:06.459258
196	126	125	T315I	-8.8	/var/lib/liganx/poses/job126_c125_T315I.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-8.43|confidence=high|strain=mild:1.08|posebusters=passed all 20 checks|contacts=PHE317:Hydr:4.0,PHE317:VdWC:2.7,LEU248:Hydr:4.0,LEU248:VdWC:3.2,VAL289:VdWC:2.8|summary=High-confidence pose (no posebusters checks failed) Key contacts: hydrophobic with ASP381; H-bond donor + hydrophobic with GLU286; hydrophobic with ILE315; hydrophobic with LEU248.	2026-04-28 06:43:22.474403
197	126	125	E255K	-8.6	/var/lib/liganx/poses/job126_c125_E255K.pdbqt	pdbfixer_mutated|mutation_outside_pocket=12.0A|engine=pod_gpu|vinardo=-7.78|confidence=high|strain=mild:1.46|posebusters=passed all 20 checks|contacts=LEU370:Hydr:4.4,LEU370:VdWC:2.1,MET290:Hydr:4.3,GLU316:VdWC:2.6,ALA269:VdWC:3.2|summary=High-confidence pose (no posebusters checks failed) Key contacts: hydrophobic with ASP381; H-bond donor + hydrophobic with GLU286; hydrophobic with LEU248; hydrophobic with LEU370.	2026-04-28 06:43:36.950844
198	126	125	Y253H	-8.2	/var/lib/liganx/poses/job126_c125_Y253H.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=-7.06|confidence=high|strain=mild:1.42|posebusters=passed all 20 checks|contacts=ILE360:HBDo:3.0,ILE360:VdWC:3.0,PHE317:Hydr:4.5,THR315:VdWC:3.0,ALA380:VdWC:2.6|summary=High-confidence pose (no posebusters checks failed) Key contacts: hydrophobic with ASP381; H-bond donor + hydrophobic with GLU286; H-bond donor with ILE360; hydrophobic with LEU248.	2026-04-28 06:43:48.402316
199	126	126	WT	-13	/var/lib/liganx/poses/job126_c126_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-13.98|confidence=unknown|strain=mild:1.43|posebusters=check_skipped: timeout|contacts=MET290:Hydr:3.7,THR315:HBDo:2.9,THR315:VdWC:2.9,PHE382:Hydr:4.4,GLU286:HBDo:3.0|summary=Key contacts: H-bond acceptor + hydrophobic with ASP381; H-bond donor with GLU286; hydrophobic with ILE313; hydrophobic with LEU248.	2026-04-28 06:44:56.609386
200	126	126	T315I	-13.6	/var/lib/liganx/poses/job126_c126_T315I.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-15.05|confidence=unknown|strain=mild:1.48|posebusters=check_skipped: timeout|contacts=MET290:Hydr:3.8,PHE317:Hydr:4.4,LYS271:Hydr:4.0,LYS271:VdWC:3.4,LEU248:Hydr:4.2|summary=Key contacts: H-bond acceptor + hydrophobic with ASP381; H-bond donor + hydrophobic with GLU286; hydrophobic with ILE313; hydrophobic with ILE315.	2026-04-28 06:46:04.072158
201	126	126	E255K	-11.9	/var/lib/liganx/poses/job126_c126_E255K.pdbqt	pdbfixer_mutated|mutation_outside_pocket=12.0A|engine=pod_gpu|vinardo=-13.08|confidence=unknown|strain=mild:1.58|posebusters=check_skipped: timeout|contacts=VAL299:VdWC:2.6,PHE317:Hydr:4.2,MET290:Hydr:3.9,MET290:VdWC:3.4,GLY321:VdWC:2.8|summary=Key contacts: H-bond donor + hydrophobic with ASP381; hydrophobic with LYS271; hydrophobic with MET290; hydrophobic with MET318.	2026-04-28 06:47:11.446535
202	126	126	Y253H	-12.4	/var/lib/liganx/poses/job126_c126_Y253H.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=-12.82|confidence=unknown|strain=mild:1.52|posebusters=check_skipped: timeout|contacts=LYS271:Hydr:4.3,HIS253:Hydr:3.9,HIS253:VdWC:3.3,LEU248:VdWC:2.6,MET318:Hydr:4.3|summary=Key contacts: H-bond donor + hydrophobic with ASP381; hydrophobic with GLU286; hydrophobic with HIS253; hydrophobic with ILE313.	2026-04-28 06:48:18.84231
203	126	127	WT	-11.3	/var/lib/liganx/poses/job126_c127_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-8.45|confidence=unknown|strain=mild:1.43|posebusters=passed all 0 checks|contacts=GLU286:Hydr:3.9,GLU286:HBDo:3.0,GLU286:VdWC:3.0,GLU316:VdWC:3.2,LYS285:Hydr:3.8|summary=Key contacts: hydrophobic with ASP381; hydrophobic with GLU282; H-bond donor + hydrophobic with GLU286; hydrophobic with LYS271.	2026-04-28 06:48:28.578777
204	126	127	T315I	-11.7	/var/lib/liganx/poses/job126_c127_T315I.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-8.55|confidence=unknown|strain=mild:1.51|posebusters=passed all 0 checks|contacts=MET290:Hydr:4.0,LEU248:VdWC:3.4,GLU282:Hydr:3.8,PHE382:Hydr:4.2,PHE382:PiSt:5.4|summary=Key contacts: hydrophobic with ASP381; hydrophobic with GLU282; H-bond donor + hydrophobic with GLU286; hydrophobic with ILE315.	2026-04-28 06:48:38.637098
205	126	127	E255K	-12.3	/var/lib/liganx/poses/job126_c127_E255K.pdbqt	pdbfixer_mutated|mutation_outside_pocket=12.0A|engine=pod_gpu|vinardo=-12.06|confidence=unknown|strain=mild:1.44|posebusters=passed all 0 checks|contacts=PHE317:Hydr:4.1,PHE317:VdWC:2.7,VAL289:VdWC:3.2,LYS271:Hydr:4.3,MET290:Hydr:4.3|summary=Key contacts: H-bond acceptor + hydrophobic with ASP381; hydrophobic with GLU286; hydrophobic with LEU248; hydrophobic with LYS271.	2026-04-28 06:48:47.609547
206	126	127	Y253H	-11.5	/var/lib/liganx/poses/job126_c127_Y253H.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=-8.53|confidence=unknown|strain=mild:1.3|posebusters=passed all 0 checks|contacts=MET290:Hydr:4.0,VAL299:VdWC:2.8,LYS271:VdWC:2.7,PHE382:Hydr:3.7,PHE382:VdWC:3.3|summary=Key contacts: hydrophobic with ASP381; hydrophobic with GLU282; H-bond donor + hydrophobic with GLU286; hydrophobic with MET290.	2026-04-28 06:48:56.712838
207	127	128	WT	-7	/var/lib/liganx/poses/job127_c128_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-5.73|confidence=unknown|strain=high:2.02|posebusters=passed all 0 checks|contacts=CYS797:Hydr:3.9,LEU844:VdWC:2.7,ALA722:VdWC:2.7,GLN791:VdWC:3.1,LEU718:Hydr:4.2|summary=Key contacts: hydrophobic with CYS797; hydrophobic with LEU718; H-bond acceptor with LYS745; hydrophobic with VAL726.	2026-04-28 06:56:23.088024
208	127	128	T790M	-7	/var/lib/liganx/poses/job127_c128_T790M.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=-5.76|confidence=unknown|strain=mild:1.96|posebusters=passed all 0 checks|contacts=LEU718:VdWC:2.4,MET793:Hydr:4.1,MET793:HBAc:3.0,MET793:VdWC:2.7,VAL726:VdWC:2.6|summary=Key contacts: hydrophobic with CYS797; H-bond acceptor + hydrophobic with MET793; van der Waals with LEU718; van der Waals with VAL726.	2026-04-28 06:56:33.749061
209	127	128	L858R	-7	/var/lib/liganx/poses/job127_c128_L858R.pdbqt	pdbfixer_mutated|mutation_outside_pocket=16.6A|engine=pod_gpu|vinardo=-5.73|confidence=unknown|strain=high:2.02|posebusters=passed all 0 checks|contacts=CYS797:Hydr:3.9,MET793:VdWC:2.7,LYS745:HBAc:3.4,LYS745:VdWC:2.4,GLN791:VdWC:3.1|summary=Key contacts: hydrophobic with CYS797; hydrophobic with LEU718; H-bond acceptor with LYS745; hydrophobic with VAL726.	2026-04-28 06:56:44.645722
210	128	129	WT	-7.2	/var/lib/liganx/poses/job128_c129_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-5.85|confidence=unknown|strain=ok:0.99|posebusters=check_skipped: timeout|contacts=LEU792:VdWC:2.5,LYS745:Hydr:4.4,LYS745:HBAc:3.3,LYS745:VdWC:2.4,LEU844:VdWC:2.2|summary=Key contacts: hydrophobic with LEU718; H-bond acceptor + hydrophobic with LYS745; H-bond acceptor with MET793; van der Waals with GLY796.	2026-04-28 07:32:31.699234
211	129	130	WT	-7	/var/lib/liganx/poses/job129_c130_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-5.69|confidence=unknown|strain=ok:0.97|posebusters=check_skipped: timeout|contacts=LEU718:Hydr:4.3,LEU718:VdWC:2.8,MET793:HBAc:3.1,MET793:VdWC:2.4,LEU792:VdWC:2.6|summary=Key contacts: hydrophobic with LEU718; hydrophobic with LYS745; H-bond acceptor with MET793; van der Waals with GLY796.	2026-04-28 07:32:43.789858
212	128	129	T790M	-7.1	/var/lib/liganx/poses/job128_c129_T790M.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-5.85|confidence=unknown|strain=mild:1.1|posebusters=check_skipped: timeout|prolif=empty|summary=No interaction data.	2026-04-28 07:33:40.465605
213	129	130	T790M	-7.1	/var/lib/liganx/poses/job129_c130_T790M.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-5.73|confidence=unknown|strain=mild:1.03|posebusters=check_skipped: timeout|contacts=LYS745:Hydr:4.4,LYS745:HBAc:3.4,LYS745:VdWC:2.4,LEU718:Hydr:4.4,LEU718:VdWC:2.5|summary=Key contacts: hydrophobic with CYS797; hydrophobic with LEU718; H-bond acceptor + hydrophobic with LYS745; H-bond acceptor with MET793.	2026-04-28 07:33:52.945436
214	128	129	L858R	-7.2	/var/lib/liganx/poses/job128_c129_L858R.pdbqt	foldx_precached|mutation_outside_pocket=16.6A|engine=pod_gpu|vinardo=-5.85|confidence=unknown|strain=ok:0.99|posebusters=check_skipped: timeout|contacts=LEU792:VdWC:2.5,GLY796:VdWC:2.7,MET793:HBAc:3.0,MET793:VdWC:2.8,LEU844:VdWC:2.2|summary=Key contacts: hydrophobic with LEU718; H-bond acceptor + hydrophobic with LYS745; H-bond acceptor with MET793; van der Waals with GLY796.	2026-04-28 07:34:49.245973
215	129	130	L858R	-7	/var/lib/liganx/poses/job129_c130_L858R.pdbqt	foldx_precached|mutation_outside_pocket=16.6A|engine=pod_gpu|vinardo=-5.69|confidence=unknown|strain=ok:0.97|posebusters=check_skipped: timeout|contacts=LEU718:Hydr:4.3,LEU718:VdWC:2.8,LEU792:VdWC:2.6,MET766:VdWC:2.5,GLY796:VdWC:2.2|summary=Key contacts: hydrophobic with LEU718; hydrophobic with LYS745; H-bond acceptor with MET793; van der Waals with GLY796.	2026-04-28 07:35:00.12402
216	135	136	WT	0	\N	ligand_prep_failed: Could not parse SMILES after strict, loose-sanitize, and Open Babel fallbacks: 'asdfghjkl'. The structure may be invalid or use a feature none of the parsers support.	2026-04-28 11:53:03.358661
217	135	136	T790M	0	\N	ligand_prep_failed: Could not parse SMILES after strict, loose-sanitize, and Open Babel fallbacks: 'asdfghjkl'. The structure may be invalid or use a feature none of the parsers support.	2026-04-28 11:53:03.358868
218	136	137	WT	0	\N	ligand_prep_failed: Ligand prep failed for '[Tc]C': atom number 0 has None type, mol name: test\natom number 0 has None type, mol name: test\natom number 0 has non finite charge, mol name: test, charge: nan\natom number 1 has non finite charge, mol name: test, charge: nan	2026-04-28 11:53:04.603431
219	136	137	T790M	0	\N	ligand_prep_failed: Ligand prep failed for '[Tc]C': atom number 0 has None type, mol name: test\natom number 0 has None type, mol name: test\natom number 0 has non finite charge, mol name: test, charge: nan\natom number 1 has non finite charge, mol name: test, charge: nan	2026-04-28 11:53:04.603621
220	137	138	WT	0	\N	ligand_prep_failed: Could not parse SMILES after strict, loose-sanitize, and Open Babel fallbacks: 'asdfghjkl'. The structure may be invalid or use a feature none of the parsers support.	2026-04-28 11:53:22.927327
221	137	138	T790M	0	\N	ligand_prep_failed: Could not parse SMILES after strict, loose-sanitize, and Open Babel fallbacks: 'asdfghjkl'. The structure may be invalid or use a feature none of the parsers support.	2026-04-28 11:53:22.92757
222	139	140	WT	0	\N	ligand_prep_failed: Could not parse SMILES after strict, loose-sanitize, and Open Babel fallbacks: "CC'); DROP TABLE jobs; --". The structure may be invalid or use a feature none of the parsers support.	2026-04-28 11:53:24.118728
223	139	140	T790M	0	\N	ligand_prep_failed: Could not parse SMILES after strict, loose-sanitize, and Open Babel fallbacks: "CC'); DROP TABLE jobs; --". The structure may be invalid or use a feature none of the parsers support.	2026-04-28 11:53:24.118944
224	138	139	WT	0	\N	ligand_prep_failed: Ligand prep failed for '[Tc]C': atom number 0 has None type, mol name: test_technetium\natom number 0 has None type, mol name: test_technetium\natom number 0 has non finite charge, mol name: test_technetium, charge: nan\natom number 1 has non finite charge, mol name: test_technetium, charge: nan	2026-04-28 11:53:24.206047
225	138	139	T790M	0	\N	ligand_prep_failed: Ligand prep failed for '[Tc]C': atom number 0 has None type, mol name: test_technetium\natom number 0 has None type, mol name: test_technetium\natom number 0 has non finite charge, mol name: test_technetium, charge: nan\natom number 1 has non finite charge, mol name: test_technetium, charge: nan	2026-04-28 11:53:24.206226
226	142	143	WT	-7	/var/lib/liganx/poses/job142_c143_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-4.74|confidence=unknown|strain=ok:0.84|posebusters=check_skipped: timeout|contacts=LYS745:HBAc:3.1,LYS745:VdWC:2.6,LEU718:VdWC:2.6,MET766:VdWC:2.7|summary=Key contacts: H-bond acceptor with LYS745; van der Waals with LEU718; van der Waals with MET766.	2026-04-28 11:54:34.758738
227	141	142	WT	-7.1	/var/lib/liganx/poses/job141_c142_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-4.76|confidence=unknown|strain=ok:0.9|posebusters=check_skipped: timeout|contacts=THR790:VdWC:2.8,LYS745:VdWC:2.7,LEU718:Hydr:4.4,LEU718:VdWC:2.7,MET766:VdWC:3.3|summary=Key contacts: hydrophobic with LEU718; van der Waals with GLY796; van der Waals with LYS745; van der Waals with MET766.	2026-04-28 11:54:34.764355
228	142	143	T790M	-7	/var/lib/liganx/poses/job142_c143_T790M.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-4.53|confidence=unknown|strain=ok:0.94|posebusters=check_skipped: timeout|prolif=empty|summary=No interaction data.	2026-04-28 11:55:42.140949
230	142	143	T790M	-7	/var/lib/liganx/poses/job142_c143_T790M.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-4.53|confidence=unknown|strain=ok:0.94|posebusters=check_skipped: timeout|prolif=empty|summary=No interaction data.	2026-04-28 11:56:49.305591
229	141	142	A790A	-7.1	/var/lib/liganx/poses/job141_c142_A790A.pdbqt	mutant_build_failed:MutateError:A790A expects A at A790, but the PDB has THR (T). Wrong PDB |engine=pod_gpu|vinardo=-4.76|confidence=unknown|strain=ok:0.9|posebusters=check_skipped: timeout|contacts=LYS745:VdWC:2.7,THR790:VdWC:2.8,LEU718:Hydr:4.4,LEU718:VdWC:2.7,MET766:VdWC:3.3|summary=Key contacts: hydrophobic with LEU718; van der Waals with GLY796; van der Waals with LYS745; van der Waals with MET766.	2026-04-28 11:55:42.760745
231	143	144	WT	-7.3	/var/lib/liganx/poses/job143_c144_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-4.89|confidence=unknown|strain=mild:1.58|posebusters=passed all 0 checks|contacts=VAL726:VdWC:2.8,PHE723:VdWC:2.4,LYS745:Hydr:3.9,LYS745:VdWC:2.6,MET766:VdWC:2.7|summary=Key contacts: H-bond donor with ASP855; hydrophobic with LYS745; van der Waals with MET766; van der Waals with PHE723.	2026-04-28 12:00:09.726326
232	153	154	WT	-5.4	/var/lib/liganx/poses/job153_c154_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-3.53|confidence=unknown|strain=ok:0.05|posebusters=passed all 0 checks|contacts=VAL726:VdWC:2.6|summary=Key contacts: van der Waals with VAL726.	2026-04-28 12:58:04.322704
233	147	148	WT	-5.4	/var/lib/liganx/poses/job147_c148_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-3.42|confidence=unknown|strain=ok:0.05|posebusters=passed all 0 checks|contacts=VAL726:VdWC:2.6|summary=Key contacts: van der Waals with VAL726.	2026-04-28 12:58:04.938769
234	146	147	WT	-5.4	/var/lib/liganx/poses/job146_c147_WT.pdbqt	pocket=catalog|engine=local_after_pod_fail|vinardo=-3.39|confidence=unknown|strain=ok:0.05|posebusters=passed all 0 checks|contacts=VAL726:VdWC:2.7|summary=Key contacts: van der Waals with VAL726.	2026-04-28 12:58:17.48305
235	154	155	WT	-5.4	/var/lib/liganx/poses/job154_c155_WT.pdbqt	pocket=catalog|engine=local_after_pod_fail|vinardo=-3.40|confidence=unknown|strain=ok:0.05|posebusters=passed all 0 checks|contacts=VAL726:VdWC:2.6|summary=Key contacts: van der Waals with VAL726.	2026-04-28 12:58:17.568807
236	152	153	WT	-5.4	/var/lib/liganx/poses/job152_c153_WT.pdbqt	pocket=catalog|engine=local_after_pod_fail|vinardo=-3.54|confidence=unknown|strain=ok:0.05|posebusters=passed all 0 checks|contacts=VAL726:VdWC:2.6,LEU718:VdWC:2.5|summary=Key contacts: van der Waals with LEU718; van der Waals with VAL726.	2026-04-28 12:58:18.239512
237	155	156	WT	-5.4	/var/lib/liganx/poses/job155_c156_WT.pdbqt	pocket=catalog|engine=local_after_pod_fail|vinardo=-3.40|confidence=unknown|strain=ok:0.05|posebusters=passed all 0 checks|contacts=VAL726:VdWC:2.6|summary=Key contacts: van der Waals with VAL726.	2026-04-28 12:58:18.715312
238	151	152	WT	-5.4	/var/lib/liganx/poses/job151_c152_WT.pdbqt	pocket=catalog|engine=local_after_pod_fail|vinardo=-3.36|confidence=unknown|strain=ok:0.05|posebusters=passed all 0 checks|contacts=VAL726:VdWC:2.7|summary=Key contacts: van der Waals with VAL726.	2026-04-28 12:58:19.671844
239	158	159	WT	-5.4	/var/lib/liganx/poses/job158_c159_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-3.48|confidence=unknown|strain=ok:0.05|posebusters=passed all 0 checks|contacts=VAL726:VdWC:2.6|summary=Key contacts: van der Waals with VAL726.	2026-04-28 12:59:45.667311
240	161	162	WT	-5.4	/var/lib/liganx/poses/job161_c162_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-3.69|confidence=unknown|strain=ok:0.05|posebusters=passed all 0 checks|contacts=VAL726:VdWC:2.6,LEU718:VdWC:2.7|summary=Key contacts: van der Waals with LEU718; van der Waals with VAL726.	2026-04-28 12:59:46.204303
241	163	164	WT	-5.4	/var/lib/liganx/poses/job163_c164_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-3.39|confidence=unknown|strain=ok:0.05|posebusters=passed all 0 checks|contacts=VAL726:VdWC:2.6|summary=Key contacts: van der Waals with VAL726.	2026-04-28 12:59:47.225693
242	164	165	WT	-5.4	/var/lib/liganx/poses/job164_c165_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-3.41|confidence=unknown|strain=ok:0.05|posebusters=passed all 0 checks|contacts=VAL726:VdWC:2.7|summary=Key contacts: van der Waals with VAL726.	2026-04-28 12:59:47.957853
243	160	161	WT	-5.4	/var/lib/liganx/poses/job160_c161_WT.pdbqt	pocket=catalog|engine=local_after_pod_fail|vinardo=-3.52|confidence=unknown|strain=ok:0.05|posebusters=passed all 0 checks|contacts=LEU718:VdWC:2.5,VAL726:VdWC:2.6|summary=Key contacts: van der Waals with LEU718; van der Waals with VAL726.	2026-04-28 13:00:15.11588
244	162	163	WT	-5.4	/var/lib/liganx/poses/job162_c163_WT.pdbqt	pocket=catalog|engine=local_after_pod_fail|vinardo=-3.52|confidence=unknown|strain=ok:0.05|posebusters=passed all 0 checks|contacts=VAL726:VdWC:2.6,LEU718:VdWC:2.5|summary=Key contacts: van der Waals with LEU718; van der Waals with VAL726.	2026-04-28 13:00:15.763163
245	159	160	WT	-5.4	/var/lib/liganx/poses/job159_c160_WT.pdbqt	pocket=catalog|engine=local_after_pod_fail|vinardo=-3.40|confidence=unknown|strain=ok:0.05|posebusters=passed all 0 checks|contacts=VAL726:VdWC:2.7|summary=Key contacts: van der Waals with VAL726.	2026-04-28 13:00:16.43537
246	167	168	WT	-7.8	/var/lib/liganx/poses/job167_c168_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-6.56|confidence=unknown|strain=mild:2.0|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 14:21:14.262903
247	167	168	Y1230H	-7.1	/var/lib/liganx/poses/job167_c168_Y1230H.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=-4.62|confidence=unknown|strain=mild:1.49|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 14:21:25.593756
248	168	169	WT	-8	/var/lib/liganx/poses/job168_c169_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-8.10|confidence=unknown|strain=mild:1.37|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 14:22:26.85071
249	168	169	Y1230H	-7.6	/var/lib/liganx/poses/job168_c169_Y1230H.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-5.37|confidence=unknown|strain=high:2.14|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 14:22:35.0062
250	168	169	D1228V	-7.7	/var/lib/liganx/poses/job168_c169_D1228V.pdbqt	pdbfixer_mutated|mutation_outside_pocket=11.6A|engine=pod_gpu|vinardo=-6.49|confidence=unknown|strain=mild:1.97|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 14:22:43.163002
251	168	170	WT	-7.8	/var/lib/liganx/poses/job168_c170_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-7.82|confidence=medium|strain=mild:1.65|posebusters=failed: internal_energy|prolif=empty|summary=Medium-confidence pose (a few posebusters checks failed)	2026-04-28 14:23:46.142688
252	168	170	Y1230H	-7.8	/var/lib/liganx/poses/job168_c170_Y1230H.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-7.37|confidence=medium|strain=mild:1.67|posebusters=failed: internal_energy|prolif=empty|summary=Medium-confidence pose (a few posebusters checks failed)	2026-04-28 14:24:48.692306
253	168	170	D1228V	-7.6	/var/lib/liganx/poses/job168_c170_D1228V.pdbqt	pdbfixer_mutated|mutation_outside_pocket=11.6A|engine=pod_gpu|vinardo=-7.85|confidence=medium|strain=mild:1.68|posebusters=failed: internal_energy|prolif=empty|summary=Medium-confidence pose (a few posebusters checks failed)	2026-04-28 14:25:51.378009
254	168	171	WT	-7.9	/var/lib/liganx/poses/job168_c171_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-6.82|confidence=unknown|strain=mild:1.59|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 14:26:01.672326
255	168	171	Y1230H	-7.7	/var/lib/liganx/poses/job168_c171_Y1230H.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-6.12|confidence=unknown|strain=mild:1.86|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 14:26:11.443444
257	168	172	WT	-8	/var/lib/liganx/poses/job168_c172_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-8.01|confidence=unknown|strain=mild:1.35|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 14:26:29.759725
256	168	171	D1228V	-8.2	/var/lib/liganx/poses/job168_c171_D1228V.pdbqt	pdbfixer_mutated|mutation_outside_pocket=11.6A|engine=pod_gpu|vinardo=-8.04|confidence=unknown|strain=high:2.45|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 14:26:20.740455
258	168	172	Y1230H	-7.9	/var/lib/liganx/poses/job168_c172_Y1230H.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-6.92|confidence=unknown|strain=mild:1.25|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 14:26:38.633684
259	168	172	D1228V	-8.3	/var/lib/liganx/poses/job168_c172_D1228V.pdbqt	pdbfixer_mutated|mutation_outside_pocket=11.6A|engine=pod_gpu|vinardo=-7.72|confidence=unknown|strain=mild:1.69|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 14:26:47.265191
260	169	173	WT	-8.3	/var/lib/liganx/poses/job169_c173_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-6.49|confidence=unknown|strain=ok:0.91|posebusters=passed all 0 checks|contacts=VAL256:VdWC:3.3,VAL289:VdWC:2.4,LYS271:VdWC:2.6,GLU286:Hydr:4.1,GLU286:VdWC:2.7|summary=Key contacts: hydrophobic with ASP381; hydrophobic with GLU282; hydrophobic with GLU286; hydrophobic with MET290.	2026-04-28 14:37:00.422762
261	169	173	Y253H	-8.1	/var/lib/liganx/poses/job169_c173_Y253H.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=-6.94|confidence=unknown|strain=mild:1.24|posebusters=passed all 0 checks|contacts=ASP381:Hydr:3.5,ASP381:VdWC:2.6,VAL289:Hydr:4.0,VAL289:VdWC:2.7,GLU286:Hydr:4.1|summary=Key contacts: hydrophobic with ASP381; hydrophobic with GLU286; hydrophobic with LYS285; hydrophobic with VAL289.	2026-04-28 14:37:12.093675
262	171	175	WT	-8.8	/var/lib/liganx/poses/job171_c175_WT.pdbqt	pocket=auto(HEM)|engine=pod_gpu|vinardo=-8.93|confidence=unknown|strain=mild:1.04|posebusters=passed all 0 checks|contacts=PRO45:VdWC:2.6,TYR35:VdWC:3.2,PHE40:VdWC:3.3,LEU37:VdWC:3.3,LEU30:VdWC:2.7|summary=Key contacts: H-bond donor with HIS68; hydrophobic + π-stacking with PHE63; hydrophobic with VAL50; van der Waals with ASN62.	2026-04-28 15:58:05.062736
263	172	176	WT	-7.2	/var/lib/liganx/poses/job172_c176_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-5.69|confidence=unknown|strain=mild:1.69|posebusters=passed all 0 checks|contacts=MET793:HBAc:3.2,MET793:VdWC:2.3,MET766:VdWC:2.6,THR854:VdWC:3.1,LYS745:Hydr:4.4|summary=Key contacts: hydrophobic with LYS745; H-bond acceptor with MET793; van der Waals with GLY796; van der Waals with LEU718.	2026-04-28 15:58:12.926114
264	172	176	T790M	-7.5	/var/lib/liganx/poses/job172_c176_T790M.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=-6.31|confidence=unknown|strain=mild:1.94|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 15:58:30.842277
265	174	177	WT	-7.2	/var/lib/liganx/poses/job174_c177_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-6.17|confidence=unknown|strain=mild:1.39|posebusters=passed all 0 checks|contacts=MET793:VdWC:2.7,CYS797:Hydr:4.2,PHE723:HBAc:3.4,PHE723:VdWC:2.5,LEU844:Hydr:4.5|summary=Key contacts: hydrophobic with CYS797; H-bond acceptor with GLY724; hydrophobic with LEU718; hydrophobic with LEU844.	2026-04-28 16:01:15.468264
266	173	179	WT	-8.8	/var/lib/liganx/poses/job173_c179_WT.pdbqt	pocket=auto(WYU)|engine=pod_gpu|vinardo=-9.08|confidence=unknown|strain=ok:0.93|posebusters=passed all 0 checks|contacts=TYR96:Hydr:3.8,VAL103:VdWC:3.5,GLN99:Hydr:3.8,TYR64:Hydr:4.5,TYR64:VdWC:2.8|summary=Key contacts: hydrophobic with GLN99; hydrophobic with GLU62; hydrophobic with ILE100; hydrophobic with MET72.	2026-04-28 16:01:15.562099
267	173	180	WT	-9	/var/lib/liganx/poses/job173_c180_WT.pdbqt	pocket=auto(WYU)|engine=pod_gpu|vinardo=-8.96|confidence=unknown|strain=ok:0.77|posebusters=passed all 0 checks|contacts=ASP69:VdWC:2.8,TYR96:Hydr:3.9,GLU62:Hydr:3.6,GLU62:VdWC:2.8,MET72:Hydr:4.3|summary=Key contacts: hydrophobic with GLN99; hydrophobic with GLU62; hydrophobic with ILE100; hydrophobic with MET72.	2026-04-28 16:01:24.06245
268	174	177	T790M	-7	/var/lib/liganx/poses/job174_c177_T790M.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-5.02|confidence=unknown|strain=mild:1.73|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 16:01:24.250881
269	174	178	WT	-7.1	/var/lib/liganx/poses/job174_c178_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-4.81|confidence=unknown|strain=mild:1.98|posebusters=passed all 0 checks|contacts=LEU844:VdWC:1.9,VAL726:VdWC:2.4,CYS797:Hydr:4.1,CYS797:VdWC:2.8,GLY724:VdWC:2.6|summary=Key contacts: hydrophobic with CYS797; van der Waals with GLY724; van der Waals with GLY796; van der Waals with LEU844.	2026-04-28 16:01:35.120227
270	174	178	T790M	-7.3	/var/lib/liganx/poses/job174_c178_T790M.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-6.87|confidence=unknown|strain=mild:1.29|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 16:01:43.666277
271	175	181	WT	-7.3	/var/lib/liganx/poses/job175_c181_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-6.19|confidence=unknown|strain=mild:1.44|posebusters=passed all 0 checks|contacts=LEU844:VdWC:3.4,MET766:VdWC:2.7,VAL726:VdWC:2.6,LEU788:VdWC:2.3,LYS745:Hydr:3.9|summary=Key contacts: hydrophobic with LYS745; van der Waals with GLY796; van der Waals with LEU788; van der Waals with LEU844.	2026-04-28 16:02:17.733597
272	175	181	T790M	-7	/var/lib/liganx/poses/job175_c181_T790M.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-4.94|confidence=unknown|strain=mild:1.55|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 16:02:26.217688
273	175	182	WT	-7.5	/var/lib/liganx/poses/job175_c182_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-6.66|confidence=unknown|strain=mild:1.74|posebusters=passed all 0 checks|contacts=VAL726:Hydr:4.5,VAL726:VdWC:2.6,GLY719:VdWC:2.6,LEU718:VdWC:2.7,LEU844:VdWC:2.8|summary=Key contacts: hydrophobic with LYS745; hydrophobic with VAL726; van der Waals with GLY719; van der Waals with LEU718.	2026-04-28 16:02:36.30581
274	175	182	T790M	-7.7	/var/lib/liganx/poses/job175_c182_T790M.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-6.63|confidence=unknown|strain=mild:1.43|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 16:02:47.222997
275	176	184	WT	-7.5	/var/lib/liganx/poses/job176_c184_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-6.15|confidence=unknown|strain=mild:1.43|posebusters=passed all 0 checks|contacts=THR790:VdWC:2.5,LEU718:Hydr:3.7,LEU718:VdWC:2.6,ALA722:VdWC:2.7,VAL726:Hydr:4.4|summary=Key contacts: H-bond acceptor with ASP855; hydrophobic with LEU718; H-bond acceptor + hydrophobic with LYS745; H-bond acceptor with THR854.	2026-04-28 16:02:56.58408
276	177	183	WT	-7.3	/var/lib/liganx/poses/job177_c183_WT.pdbqt	pocket=auto(PG0)|engine=pod_gpu|vinardo=-5.82|confidence=unknown|strain=mild:1.94|posebusters=passed all 0 checks|contacts=PRO410:VdWC:2.5,GLY234:HBAc:3.0,GLY234:VdWC:3.0,ASN233:VdWC:2.7,LEU536:Hydr:4.2|summary=Key contacts: H-bond acceptor with GLY234; hydrophobic with LEU536; van der Waals with ASN233; van der Waals with GLN413.	2026-04-28 16:02:59.890261
277	176	184	T790M	-7.3	/var/lib/liganx/poses/job176_c184_T790M.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-4.80|confidence=unknown|strain=mild:1.33|posebusters=passed all 0 checks|contacts=LYS745:HBAc:3.4,LYS745:VdWC:2.8,LEU792:VdWC:3.2,LEU844:VdWC:2.8,MET793:HBAc:3.3|summary=Key contacts: H-bond acceptor with LYS745; H-bond acceptor with MET793; van der Waals with CYS797; van der Waals with GLY796.	2026-04-28 16:03:06.702337
278	176	184	L858R	-7.5	/var/lib/liganx/poses/job176_c184_L858R.pdbqt	pdbfixer_mutated|mutation_outside_pocket=16.6A|engine=pod_gpu|vinardo=-6.15|confidence=unknown|strain=mild:1.43|posebusters=passed all 0 checks|contacts=VAL726:Hydr:4.4,VAL726:VdWC:2.7,ASP855:HBAc:3.4,ASP855:VdWC:2.4,PHE723:VdWC:2.8|summary=Key contacts: H-bond acceptor with ASP855; hydrophobic with LEU718; H-bond acceptor + hydrophobic with LYS745; H-bond acceptor with THR854.	2026-04-28 16:03:16.224607
279	176	184	C797S	-7.6	/var/lib/liganx/poses/job176_c184_C797S.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=-6.17|confidence=unknown|strain=mild:1.42|posebusters=passed all 0 checks|contacts=ASP855:HBAc:3.4,ASP855:VdWC:2.4,LYS745:Hydr:3.7,LYS745:HBAc:3.4,LYS745:VdWC:2.6|summary=Key contacts: H-bond acceptor with ASP855; hydrophobic with LEU718; H-bond acceptor + hydrophobic with LYS745; H-bond acceptor with THR854.	2026-04-28 16:03:25.360596
280	178	185	WT	-7.8	/var/lib/liganx/poses/job178_c185_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-5.91|confidence=unknown|strain=mild:1.83|posebusters=passed all 0 checks|contacts=GLY796:VdWC:2.7,LYS745:Hydr:4.1,LYS745:VdWC:2.7,LEU844:VdWC:2.7,LEU747:VdWC:3.1|summary=Key contacts: hydrophobic with LEU718; hydrophobic with LYS745; H-bond acceptor with MET793; van der Waals with GLY724.	2026-04-28 16:04:23.080003
286	180	191	G12V	-6.9	/var/lib/liganx/poses/job180_c191_G12V.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=-6.56|confidence=unknown|strain=mild:1.49|posebusters=passed all 0 checks|contacts=LEU120:VdWC:2.5,GLY13:VdWC:2.8,ALA146:VdWC:2.6,LYS117:Hydr:4.2,LYS117:VdWC:2.8|summary=Key contacts: H-bond acceptor with ASN116; hydrophobic with LYS117; hydrophobic with LYS147; hydrophobic with PHE28.	2026-04-28 16:11:20.540522
293	180	192	WT	-6.1	/var/lib/liganx/poses/job180_c192_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-6.31|confidence=unknown|strain=mild:1.66|posebusters=check_skipped: timeout|contacts=LEU120:VdWC:2.5,LYS147:Hydr:4.4,LYS147:VdWC:2.7,ASN116:HBAc:3.2,ASN116:VdWC:2.5|summary=Key contacts: H-bond acceptor with ASN116; hydrophobic with LYS117; hydrophobic with LYS147; hydrophobic with PHE28.	2026-04-28 16:12:37.869881
296	180	192	G12V	-6.7	/var/lib/liganx/poses/job180_c192_G12V.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=-7.34|confidence=unknown|strain=mild:1.91|posebusters=check_skipped: timeout|contacts=ASN116:HBAc:3.3,ASN116:VdWC:2.6,LYS147:Hydr:3.8,LEU120:Hydr:4.4,LEU120:VdWC:2.5|summary=Key contacts: H-bond acceptor with ASN116; hydrophobic with LEU120; hydrophobic with LYS117; hydrophobic with LYS147.	2026-04-28 16:13:48.461696
301	180	193	WT	-7.1	/var/lib/liganx/poses/job180_c193_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-5.45|confidence=unknown|strain=high:2.03|posebusters=passed all 0 checks|contacts=PHE28:Hydr:4.5,PHE28:PiSt:4.8,PHE28:VdWC:2.6,SER17:VdWC:2.7,GLY13:VdWC:2.7|summary=Key contacts: hydrophobic with LEU120; hydrophobic with LYS117; hydrophobic + π-stacking with PHE28; van der Waals with ALA18.	2026-04-28 16:15:14.248981
305	181	189	T790M	-7.3	/var/lib/liganx/poses/job181_c189_T790M.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-5.84|confidence=unknown|strain=mild:1.64|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 16:15:33.945131
310	181	190	WT	-7.1	/var/lib/liganx/poses/job181_c190_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-5.94|confidence=unknown|strain=mild:1.78|posebusters=passed all 0 checks|contacts=ASP855:VdWC:3.2,LYS745:Hydr:4.1,LYS745:HBAc:3.4,LYS745:VdWC:2.6,ALA722:VdWC:3.0|summary=Key contacts: H-bond acceptor with GLY724; H-bond acceptor + hydrophobic with LYS745; H-bond acceptor with PHE723; hydrophobic with VAL726.	2026-04-28 16:16:06.541283
314	181	190	C797S	-7.1	/var/lib/liganx/poses/job181_c190_C797S.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-5.96|confidence=unknown|strain=mild:1.79|posebusters=passed all 0 checks|contacts=PHE723:HBAc:3.3,PHE723:VdWC:2.5,LEU788:VdWC:2.5,ALA722:VdWC:3.0,VAL726:Hydr:4.2|summary=Key contacts: H-bond acceptor with GLY724; H-bond acceptor + hydrophobic with LYS745; H-bond acceptor with PHE723; hydrophobic with VAL726.	2026-04-28 16:16:29.209552
281	179	186	WT	-7.3	/var/lib/liganx/poses/job179_c186_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-6.76|confidence=unknown|strain=mild:1.45|posebusters=passed all 0 checks|contacts=ASN116:HBAc:3.3,ASN116:VdWC:2.6,LYS117:Hydr:4.3,LYS117:VdWC:2.8,LYS147:Hydr:3.7|summary=Key contacts: H-bond acceptor with ASN116; hydrophobic with LYS117; hydrophobic with LYS147; hydrophobic with PHE28.	2026-04-28 16:04:23.470334
282	179	186	G12C	-7.6	/var/lib/liganx/poses/job179_c186_G12C.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=-6.51|confidence=unknown|strain=mild:1.49|posebusters=passed all 0 checks|contacts=LEU120:Hydr:3.8,LEU120:VdWC:2.6,ALA146:VdWC:3.4,PHE28:Hydr:4.5,PHE28:VdWC:2.8|summary=Key contacts: hydrophobic with LEU120; hydrophobic with LYS117; hydrophobic with LYS147; hydrophobic with PHE28.	2026-04-28 16:04:31.933189
283	178	185	T790M	-7.7	/var/lib/liganx/poses/job178_c185_T790M.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-6.62|confidence=unknown|strain=mild:1.16|posebusters=passed all 0 checks|contacts=LEU718:Hydr:4.1,LEU718:VdWC:3.1,VAL726:VdWC:2.2,MET793:VdWC:2.4,LYS745:HBAc:3.2|summary=Key contacts: hydrophobic with LEU718; H-bond acceptor with LYS745; van der Waals with GLY796; van der Waals with MET766.	2026-04-28 16:04:32.806254
284	180	191	WT	-6.8	/var/lib/liganx/poses/job180_c191_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-6.49|confidence=unknown|strain=mild:1.53|posebusters=passed all 0 checks|contacts=LYS147:Hydr:4.4,LYS147:VdWC:2.6,ALA18:VdWC:2.7,PHE28:Hydr:4.3,LEU120:VdWC:2.6|summary=Key contacts: H-bond acceptor with ASN116; hydrophobic with LYS117; hydrophobic with LYS147; hydrophobic with PHE28.	2026-04-28 16:11:12.346829
285	181	187	WT	-7.3	/var/lib/liganx/poses/job181_c187_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-6.80|confidence=unknown|strain=mild:1.32|posebusters=passed all 0 checks|contacts=THR790:VdWC:3.4,CYS797:VdWC:2.6,PRO794:VdWC:3.2,LYS745:Hydr:4.4,LYS745:VdWC:2.7|summary=Key contacts: hydrophobic with LYS745; H-bond acceptor with MET793; van der Waals with CYS797; van der Waals with LEU718.	2026-04-28 16:11:12.814768
287	181	187	T790M	-7.3	/var/lib/liganx/poses/job181_c187_T790M.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-5.55|confidence=unknown|strain=high:2.1|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 16:11:21.808859
288	180	191	G12D	-6.9	/var/lib/liganx/poses/job180_c191_G12D.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=-5.22|confidence=unknown|strain=mild:1.29|posebusters=passed all 0 checks|contacts=GLY13:HBAc:3.1,GLY13:VdWC:3.1,LYS16:VdWC:3.1,LYS117:Hydr:4.4,LYS117:VdWC:2.7|summary=Key contacts: H-bond acceptor with GLY13; hydrophobic with LYS117; hydrophobic + π-stacking with PHE28; H-bond acceptor with SER17.	2026-04-28 16:11:28.425278
289	181	187	C797S	-7.1	/var/lib/liganx/poses/job181_c187_C797S.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-5.39|confidence=unknown|strain=mild:1.36|posebusters=passed all 0 checks|contacts=LEU718:VdWC:2.8,SER797:HBDo:3.1,SER797:VdWC:3.1,VAL726:VdWC:2.8,LEU792:VdWC:2.6|summary=Key contacts: hydrophobic with LEU844; H-bond acceptor + hydrophobic with MET793; H-bond donor with SER797; van der Waals with GLY796.	2026-04-28 16:11:30.624948
290	182	195	WT	-6.9	/var/lib/liganx/poses/job182_c195_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-5.95|confidence=unknown|strain=mild:1.39|posebusters=passed all 0 checks|contacts=GLY724:HBAc:3.5,GLY724:VdWC:2.5,LEU718:VdWC:2.6,LYS745:Hydr:3.7,LYS745:HBAc:3.3|summary=Key contacts: H-bond donor with ASP855; H-bond acceptor with GLY724; H-bond acceptor + hydrophobic with LYS745; van der Waals with LEU718.	2026-04-28 16:12:03.905488
291	182	195	T790M	-6.8	/var/lib/liganx/poses/job182_c195_T790M.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-4.78|confidence=unknown|strain=mild:1.79|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 16:12:20.561454
292	182	195	L858R	-6.9	/var/lib/liganx/poses/job182_c195_L858R.pdbqt	foldx_precached|mutation_outside_pocket=16.6A|engine=pod_gpu|vinardo=-5.95|confidence=unknown|strain=mild:1.39|posebusters=passed all 0 checks|contacts=ASP855:HBDo:3.1,ASP855:VdWC:2.3,LYS745:Hydr:3.7,LYS745:HBAc:3.3,LYS745:VdWC:2.7|summary=Key contacts: H-bond donor with ASP855; H-bond acceptor with GLY724; H-bond acceptor + hydrophobic with LYS745; van der Waals with LEU718.	2026-04-28 16:12:37.137083
294	181	188	WT	-6.4	/var/lib/liganx/poses/job181_c188_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-6.00|confidence=unknown|strain=mild:1.07|posebusters=check_skipped: timeout|contacts=PHE723:Hydr:4.1,PHE723:VdWC:2.7,LYS745:Hydr:4.1,LYS745:HBAc:3.1,LYS745:VdWC:2.7|summary=Key contacts: H-bond acceptor + hydrophobic with LYS745; H-bond acceptor with MET793; hydrophobic with PHE723; hydrophobic with VAL726.	2026-04-28 16:12:40.273199
295	182	195	C797S	-7.3	/var/lib/liganx/poses/job182_c195_C797S.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-5.72|confidence=unknown|strain=high:2.16|posebusters=passed all 0 checks|contacts=LEU844:Hydr:4.2,LEU844:VdWC:2.8,THR854:VdWC:2.8,MET793:HBAc:3.3,MET793:VdWC:2.3|summary=Key contacts: hydrophobic with LEU844; hydrophobic with LYS745; H-bond acceptor with MET793; van der Waals with ALA743.	2026-04-28 16:12:51.985488
297	181	188	T790M	-6.3	/var/lib/liganx/poses/job181_c188_T790M.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-5.24|confidence=unknown|strain=mild:1.55|posebusters=check_skipped: timeout|prolif=empty|summary=No interaction data.	2026-04-28 16:13:51.021524
298	182	196	WT	-6.8	/var/lib/liganx/poses/job182_c196_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-5.99|confidence=unknown|strain=mild:1.22|posebusters=check_skipped: timeout|contacts=LEU718:VdWC:2.8,THR854:VdWC:3.0,GLY796:VdWC:2.8,LYS745:Hydr:4.4,LYS745:VdWC:2.5|summary=Key contacts: H-bond donor with ASP855; hydrophobic with LYS745; hydrophobic with PHE723; van der Waals with GLY796.	2026-04-28 16:14:09.766381
299	180	192	G12D	-6.5	/var/lib/liganx/poses/job180_c192_G12D.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=-6.73|confidence=unknown|strain=mild:1.52|posebusters=check_skipped: timeout|contacts=PHE28:Hydr:4.3,PHE28:VdWC:2.6,ALA146:VdWC:2.6,LYS117:Hydr:4.0,LEU120:VdWC:2.6|summary=Key contacts: H-bond acceptor with ASN116; hydrophobic with LYS117; hydrophobic with LYS147; hydrophobic with PHE28.	2026-04-28 16:14:58.932929
300	181	188	C797S	-6.7	/var/lib/liganx/poses/job181_c188_C797S.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-5.54|confidence=unknown|strain=mild:1.29|posebusters=check_skipped: timeout|contacts=LYS745:Hydr:4.2,LYS745:VdWC:2.4,ASP855:HBDo:3.0,ASP855:VdWC:3.0,THR854:VdWC:3.0|summary=Key contacts: H-bond donor with ASP855; hydrophobic with LYS745; hydrophobic with PHE723; van der Waals with MET793.	2026-04-28 16:15:03.612963
302	182	196	T790M	-6.6	/var/lib/liganx/poses/job182_c196_T790M.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-5.32|confidence=unknown|strain=mild:1.3|posebusters=check_skipped: timeout|prolif=empty|summary=No interaction data.	2026-04-28 16:15:17.77687
303	181	189	WT	-7.2	/var/lib/liganx/poses/job181_c189_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-6.17|confidence=unknown|strain=high:2.49|posebusters=passed all 0 checks|contacts=ASP855:VdWC:2.2,MET793:VdWC:3.1,PHE723:VdWC:2.8,LYS745:Hydr:4.1,LYS745:HBAc:3.2|summary=Key contacts: hydrophobic with LEU718; H-bond acceptor + hydrophobic with LYS745; hydrophobic with VAL726; van der Waals with ASP855.	2026-04-28 16:15:18.472874
304	180	193	G12V	-7	/var/lib/liganx/poses/job180_c193_G12V.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=-5.73|confidence=unknown|strain=high:2.12|posebusters=passed all 0 checks|contacts=LYS147:Hydr:3.6,LYS147:VdWC:2.7,PRO34:VdWC:2.7,PHE28:Hydr:4.3,GLY15:VdWC:2.6|summary=Key contacts: hydrophobic with LEU120; hydrophobic + π-cation with LYS117; hydrophobic with LYS147; hydrophobic with PHE28.	2026-04-28 16:15:24.202726
308	180	194	WT	-6.8	/var/lib/liganx/poses/job180_c194_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-5.78|confidence=unknown|strain=mild:1.44|posebusters=passed all 0 checks|contacts=PHE28:Hydr:4.4,PHE28:PiSt:5.2,GLY13:VdWC:2.6,PRO34:VdWC:3.4,LYS16:VdWC:2.6|summary=Key contacts: hydrophobic with LEU120; hydrophobic with LYS117; hydrophobic + π-stacking with PHE28; van der Waals with ASN116.	2026-04-28 16:15:51.329081
312	181	190	T790M	-7.5	/var/lib/liganx/poses/job181_c190_T790M.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-7.03|confidence=unknown|strain=ok:0.99|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 16:16:19.657958
306	180	193	G12D	-6.4	/var/lib/liganx/poses/job180_c193_G12D.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=-4.32|confidence=unknown|strain=mild:1.91|posebusters=passed all 0 checks|contacts=TYR32:HBAc:3.3,TYR32:VdWC:2.8,LYS147:Hydr:3.8,LYS147:VdWC:2.7,GLY13:VdWC:2.6|summary=Key contacts: hydrophobic with LEU120; hydrophobic with LYS117; hydrophobic with LYS147; hydrophobic + π-stacking with PHE28.	2026-04-28 16:15:37.261885
309	180	194	G12V	-7	/var/lib/liganx/poses/job180_c194_G12V.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=-6.75|confidence=unknown|strain=mild:1.36|posebusters=passed all 0 checks|contacts=LEU120:Hydr:4.3,LEU120:VdWC:3.2,GLY15:VdWC:2.7,GLY13:VdWC:3.0,PHE28:Hydr:4.5|summary=Key contacts: H-bond acceptor with ASN116; hydrophobic with LEU120; hydrophobic with LYS117; hydrophobic with LYS147.	2026-04-28 16:16:03.865119
307	181	189	C797S	-6.8	/var/lib/liganx/poses/job181_c189_C797S.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-5.97|confidence=unknown|strain=high:2.69|posebusters=passed all 0 checks|contacts=ARG841:VdWC:2.5,LEU844:VdWC:2.7,LYS745:Hydr:4.3,LYS745:VdWC:2.5,LEU718:Hydr:4.0|summary=Key contacts: hydrophobic with LEU718; hydrophobic with LYS745; van der Waals with ARG841; van der Waals with GLY719.	2026-04-28 16:15:50.23309
311	180	194	G12D	-7.4	/var/lib/liganx/poses/job180_c194_G12D.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=-6.07|confidence=unknown|strain=mild:1.3|posebusters=passed all 0 checks|contacts=LYS117:Hydr:4.3,LYS117:VdWC:2.4,PHE28:Hydr:3.9,PHE28:PiSt:4.8,SER17:VdWC:2.8|summary=Key contacts: H-bond donor with ASP30; hydrophobic with LYS117; hydrophobic + π-stacking with PHE28; van der Waals with GLY13.	2026-04-28 16:16:15.485429
313	182	196	L858R	-6.8	/var/lib/liganx/poses/job182_c196_L858R.pdbqt	foldx_precached|mutation_outside_pocket=16.6A|engine=pod_gpu|vinardo=-5.99|confidence=unknown|strain=mild:1.22|posebusters=check_skipped: timeout|contacts=PHE723:Hydr:4.2,ASP855:HBDo:3.1,ASP855:VdWC:2.0,THR854:VdWC:3.0,LYS745:Hydr:4.4|summary=Key contacts: H-bond donor with ASP855; hydrophobic with LYS745; hydrophobic with PHE723; van der Waals with GLY796.	2026-04-28 16:16:26.212152
315	182	196	C797S	-6.3	/var/lib/liganx/poses/job182_c196_C797S.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-5.43|confidence=medium|strain=mild:1.29|posebusters=failed: internal_energy|contacts=GLY796:VdWC:2.8,LEU718:Hydr:4.5,LEU718:VdWC:2.8,MET766:VdWC:2.7,THR854:VdWC:3.0|summary=Medium-confidence pose (a few posebusters checks failed) Key contacts: hydrophobic with LEU718; van der Waals with GLY796; van der Waals with LYS745; van der Waals with MET766.	2026-04-28 16:17:29.141608
316	182	197	WT	-7.3	/var/lib/liganx/poses/job182_c197_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-6.38|confidence=unknown|strain=high:2.76|posebusters=passed all 0 checks|contacts=CYS797:VdWC:2.6,PHE723:VdWC:2.8,LEU747:VdWC:3.4,ASP855:VdWC:3.1,LYS745:Hydr:3.9|summary=Key contacts: hydrophobic with LEU718; hydrophobic with LYS745; hydrophobic with VAL726; van der Waals with ASP855.	2026-04-28 16:17:40.563503
317	182	197	T790M	-7.9	/var/lib/liganx/poses/job182_c197_T790M.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-6.98|confidence=unknown|strain=mild:1.33|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 16:17:49.880473
318	182	197	L858R	-7.3	/var/lib/liganx/poses/job182_c197_L858R.pdbqt	foldx_precached|mutation_outside_pocket=16.6A|engine=pod_gpu|vinardo=-6.39|confidence=unknown|strain=high:2.73|posebusters=passed all 0 checks|contacts=LYS745:Hydr:4.0,LYS745:VdWC:2.5,PHE723:VdWC:2.7,LEU747:VdWC:3.4,VAL726:Hydr:3.9|summary=Key contacts: hydrophobic with LEU718; hydrophobic with LYS745; hydrophobic with VAL726; van der Waals with ASP855.	2026-04-28 16:17:59.72465
319	182	197	C797S	-6.9	/var/lib/liganx/poses/job182_c197_C797S.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-6.36|confidence=unknown|strain=high:2.04|posebusters=passed all 0 checks|contacts=GLY796:VdWC:2.7,LEU718:VdWC:2.5,LYS745:Hydr:4.2,LYS745:HBAc:3.2,LYS745:VdWC:2.6|summary=Key contacts: H-bond acceptor + hydrophobic with LYS745; hydrophobic with MET793; hydrophobic with VAL726; van der Waals with ASP855.	2026-04-28 16:18:09.723142
320	182	198	WT	-7.2	/var/lib/liganx/poses/job182_c198_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-6.17|confidence=unknown|strain=mild:1.69|posebusters=passed all 0 checks|contacts=ALA722:VdWC:3.3,LEU844:VdWC:2.7,GLY724:VdWC:2.7,VAL726:Hydr:4.2,VAL726:VdWC:2.8|summary=Key contacts: hydrophobic with LYS745; hydrophobic with VAL726; van der Waals with ALA722; van der Waals with GLY724.	2026-04-28 16:18:19.364177
321	182	198	T790M	-7.8	/var/lib/liganx/poses/job182_c198_T790M.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-6.50|confidence=unknown|strain=mild:1.65|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 16:18:28.153439
322	182	198	L858R	-7.3	/var/lib/liganx/poses/job182_c198_L858R.pdbqt	foldx_precached|mutation_outside_pocket=16.6A|engine=pod_gpu|vinardo=-6.08|confidence=unknown|strain=mild:1.66|posebusters=passed all 0 checks|contacts=GLY724:VdWC:2.6,LEU844:VdWC:2.7,LYS745:Hydr:4.3,LYS745:VdWC:2.6,VAL726:Hydr:4.2|summary=Key contacts: hydrophobic with LYS745; hydrophobic with VAL726; van der Waals with ALA722; van der Waals with GLY724.	2026-04-28 16:18:37.989878
323	182	198	C797S	-7.4	/var/lib/liganx/poses/job182_c198_C797S.pdbqt	foldx_precached|engine=pod_gpu|vinardo=-6.11|confidence=unknown|strain=mild:1.67|posebusters=passed all 0 checks|contacts=GLY724:VdWC:2.6,LEU844:VdWC:2.7,ALA722:VdWC:3.3,LYS745:Hydr:4.3,LYS745:VdWC:2.5|summary=Key contacts: hydrophobic with LYS745; hydrophobic with VAL726; van der Waals with ALA722; van der Waals with GLY724.	2026-04-28 16:18:47.025452
324	184	201	WT	-6.6	/var/lib/liganx/poses/job184_c201_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-5.98|confidence=unknown|strain=mild:1.48|posebusters=passed all 0 checks|contacts=GLY15:VdWC:2.7,TYR32:VdWC:2.8,ASN116:HBAc:3.3,PRO34:VdWC:2.8,LYS117:Hydr:4.4|summary=Key contacts: H-bond acceptor with ASN116; H-bond acceptor + hydrophobic + π-cation with LYS117; hydrophobic + π-stacking with PHE28; van der Waals with ALA146.	2026-04-28 16:30:31.542681
325	184	201	G12C	-7	/var/lib/liganx/poses/job184_c201_G12C.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=-5.70|confidence=unknown|strain=mild:1.48|posebusters=passed all 0 checks|contacts=PHE28:Hydr:3.6,PHE28:PiSt:4.8,PHE28:VdWC:2.8,SER17:VdWC:2.5,VAL29:VdWC:2.5|summary=Key contacts: H-bond acceptor + hydrophobic with LYS117; hydrophobic + π-stacking with PHE28; van der Waals with ASP30; van der Waals with GLY13.	2026-04-28 16:30:41.904007
326	184	202	WT	-7.6	/var/lib/liganx/poses/job184_c202_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-6.33|confidence=unknown|strain=mild:1.35|posebusters=passed all 0 checks|contacts=GLY15:VdWC:3.2,SER17:VdWC:2.6,ASN116:VdWC:2.5,LYS16:VdWC:2.6,LYS117:Hydr:4.0|summary=Key contacts: hydrophobic with LYS117; hydrophobic + π-stacking with PHE28; van der Waals with ASN116; van der Waals with GLY13.	2026-04-28 16:30:54.243477
327	184	202	G12C	-6.7	/var/lib/liganx/poses/job184_c202_G12C.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=-5.21|confidence=unknown|strain=mild:1.64|posebusters=passed all 0 checks|contacts=ALA18:HBAc:3.4,GLU31:VdWC:2.8,TYR32:HBAc:3.3,TYR32:VdWC:2.6,ASP30:VdWC:2.4|summary=Key contacts: H-bond acceptor with ALA146; H-bond acceptor with ALA18; H-bond acceptor with TYR32; van der Waals with ASN116.	2026-04-28 16:31:02.559799
328	185	203	WT	-7	/var/lib/liganx/poses/job185_c203_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-5.97|confidence=unknown|strain=mild:1.89|posebusters=passed all 0 checks|contacts=LEU844:Hydr:4.4,LYS745:VdWC:2.7,MET793:VdWC:2.6,LEU718:Hydr:4.2,CYS797:Hydr:4.4|summary=Key contacts: hydrophobic with CYS797; hydrophobic with LEU718; hydrophobic with LEU844; hydrophobic with VAL726.	2026-04-28 16:34:27.303809
329	185	203	T790M	-8.1	/var/lib/liganx/poses/job185_c203_T790M.pdbqt	pdbfixer_mutated|engine=pod_gpu|vinardo=-7.25|confidence=unknown|strain=high:2.01|posebusters=passed all 0 checks|prolif=empty|summary=No interaction data.	2026-04-28 16:34:38.761715
330	186	204	WT	-3.7	/var/lib/liganx/poses/job186_c204_WT.pdbqt	pocket=auto(SF4)|engine=pod_gpu|vinardo=-3.93|confidence=unknown|strain=mild:1.56|posebusters=passed all 0 checks|contacts=LEU17:Hydr:4.3,LEU17:VdWC:2.5,LEU63:VdWC:2.4|summary=Key contacts: hydrophobic with LEU17; van der Waals with LEU63.	2026-04-28 17:36:40.483256
331	186	204	C481S	-3.7	/var/lib/liganx/poses/job186_c204_C481S.pdbqt	mutant_build_failed:MutateError:Residue A481 (from C481S) not found in 5D8V_A.clean.pdb. Wro|engine=pod_gpu|vinardo=-3.93|confidence=unknown|strain=mild:1.56|posebusters=passed all 0 checks|contacts=LEU63:VdWC:2.4,LEU17:Hydr:4.3,LEU17:VdWC:2.5|summary=Key contacts: hydrophobic with LEU17; van der Waals with LEU63.	2026-04-28 17:36:47.650219
332	186	205	WT	-3.7	/var/lib/liganx/poses/job186_c205_WT.pdbqt	pocket=auto(SF4)|engine=pod_gpu|vinardo=-3.42|confidence=unknown|strain=mild:1.31|posebusters=passed all 0 checks|contacts=ARG33:VdWC:2.5,LEU63:VdWC:2.6,THR13:VdWC:2.4,THR79:VdWC:3.0,LEU17:Hydr:4.3|summary=Key contacts: hydrophobic with LEU17; van der Waals with ARG33; van der Waals with LEU63; van der Waals with THR13.	2026-04-28 17:36:55.912949
333	186	205	C481S	-3.7	/var/lib/liganx/poses/job186_c205_C481S.pdbqt	mutant_build_failed:MutateError:Residue A481 (from C481S) not found in 5D8V_A.clean.pdb. Wro|engine=pod_gpu|vinardo=-3.42|confidence=unknown|strain=mild:1.31|posebusters=passed all 0 checks|contacts=LEU63:VdWC:2.6,LEU17:Hydr:4.3,LEU17:VdWC:2.7,ARG33:VdWC:2.5,THR13:VdWC:2.4|summary=Key contacts: hydrophobic with LEU17; van der Waals with ARG33; van der Waals with LEU63; van der Waals with THR13.	2026-04-28 17:37:03.061856
334	187	206	WT	-6.8	/var/lib/liganx/poses/job187_c206_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-5.41|confidence=unknown|strain=mild:1.97|posebusters=passed all 0 checks|contacts=LEU120:VdWC:2.5,LYS117:HBAc:3.1,LYS117:VdWC:3.1,PHE28:Hydr:4.5,PHE28:PiSt:5.0|summary=Key contacts: H-bond acceptor with LYS117; hydrophobic + π-stacking with PHE28; van der Waals with LEU120; van der Waals with SER17.	2026-04-28 18:14:00.195817
335	187	206	Q61H	-7.7	/var/lib/liganx/poses/job187_c206_Q61H.pdbqt	pdbfixer_mutated|mutation_outside_pocket=19.2A|engine=pod_gpu|vinardo=-7.40|confidence=unknown|strain=mild:1.64|posebusters=passed all 0 checks|contacts=PRO34:VdWC:3.0,TYR32:Hydr:4.3,GLY15:HBDo:3.2,GLY15:VdWC:2.4,PHE28:VdWC:2.6|summary=Key contacts: H-bond donor with GLY15; hydrophobic with TYR32; van der Waals with ASP30; van der Waals with GLY13.	2026-04-28 18:14:08.890785
336	187	207	WT	-7.4	/var/lib/liganx/poses/job187_c207_WT.pdbqt	pocket=catalog|engine=pod_gpu|vinardo=-5.22|confidence=unknown|strain=mild:1.18|posebusters=passed all 0 checks|contacts=LYS117:VdWC:2.6,SER17:VdWC:3.3,GLY13:HBAc:2.8,GLY13:VdWC:2.7,ASN116:HBAc:3.1|summary=Key contacts: H-bond acceptor with ASN116; H-bond acceptor with GLY13; van der Waals with LYS117; van der Waals with PRO34.	2026-04-28 18:14:17.404402
337	187	207	Q61H	-7.8	/var/lib/liganx/poses/job187_c207_Q61H.pdbqt	pdbfixer_mutated|mutation_outside_pocket=19.2A|engine=pod_gpu|vinardo=-5.87|confidence=unknown|strain=mild:1.49|posebusters=passed all 0 checks|contacts=PRO34:VdWC:2.6,LYS117:Hydr:4.5,LYS117:VdWC:2.7,GLY12:VdWC:2.5,GLY15:VdWC:2.7|summary=Key contacts: H-bond acceptor with GLY13; hydrophobic with LYS117; H-bond acceptor with LYS16; hydrophobic + π-stacking with PHE28.	2026-04-28 18:14:25.54434
\.


--
-- Data for Name: job; Type: TABLE DATA; Schema: public; Owner: -
--

COPY "public"."job" ("id", "share_id", "created_at", "updated_at", "uniprot_id", "pdb_id", "chain", "mutations", "exhaustiveness", "include_wt", "status", "error_message", "user_id") FROM stdin;
1	nbhU-h_pF0A	2026-04-27 20:59:03.604244	2026-04-27 20:59:51.76724	P00533	2RGP	A	T790M	8	f	COMPLETED	\N	\N
31	j9ES3pPlzl0	2026-04-28 01:23:31.586431	2026-04-28 01:24:12.691202	P00533	2RGP	A	T790M	8	t	COMPLETED	\N	\N
61	6xX9uFf8b_4	2026-04-28 05:04:22.312761	2026-04-28 05:04:56.667673	P36888	4XUF	A	D835V	8	t	COMPLETED	\N	\N
32	yfhCw6brG5Y	2026-04-28 01:26:52.579236	2026-04-28 01:27:33.523169	P00533	2RGP	A	T790M	8	t	COMPLETED	\N	\N
62	4jqCpj_S0Uo	2026-04-28 05:08:10.446025	2026-04-28 05:08:46.847117	P36888	4XUF	A	D835V	8	t	COMPLETED	\N	\N
33	NF2i6JXP17k	2026-04-28 01:31:37.822761	2026-04-28 01:32:18.722206	P00533	2RGP	A	T790M	8	t	COMPLETED	\N	\N
34	-JczsOoN25Y	2026-04-28 01:36:27.886537	2026-04-28 01:37:09.014353	P00533	2RGP	A	T790M	8	t	COMPLETED	\N	\N
63	OHdqyGhv_nY	2026-04-28 05:18:53.046513	2026-04-28 05:19:24.700871	P36888	4XUF	A	D835V	8	t	COMPLETED	\N	\N
35	Gv5MzrnRmYE	2026-04-28 01:39:36.919358	2026-04-28 01:40:18.349167	P00533	2RGP	A	T790M	8	t	COMPLETED	\N	\N
36	7MKLZiWXZUI	2026-04-28 01:47:32.46646	2026-04-28 01:48:13.054476	P00533	2RGP	A	T790M	8	t	COMPLETED	\N	\N
11	7BZ4rEVu9yg	2026-04-27 21:27:20.989477	2026-04-27 21:27:23.792199	\N	2RGP	A	T790M	8	f	COMPLETED	\N	\N
64	Oa1XlHPl72k	2026-04-28 05:21:32.338858	2026-04-28 05:22:18.166694	P36888	4XUF	A	D835V	8	t	COMPLETED	\N	\N
37	mAaAUQ2umfI	2026-04-28 01:50:29.387736	2026-04-28 01:51:10.038419	P00533	2RGP	A	T790M	8	t	COMPLETED	\N	\N
65	b4FaZ_lYlL0	2026-04-28 05:21:42.114741	2026-04-28 05:22:20.84255	P00533	2ITY	A	C797S	8	t	COMPLETED	\N	\N
7	ApHEAGTSi4c	2026-04-27 21:27:16.237998	2026-04-27 21:27:35.44946	\N	2RGP	A		8	t	COMPLETED	\N	\N
9	Ke6PYetOhvQ	2026-04-27 21:27:18.148229	2026-04-27 21:27:50.145612	\N	2RGP	A	T790M	32	t	COMPLETED	\N	\N
8	tjdAjS6i9zU	2026-04-27 21:27:17.252701	2026-04-27 21:28:13.943588	\N	2RGP	A	T790M+C797S	8	f	COMPLETED	\N	\N
10	DpFr9UFluQw	2026-04-27 21:27:19.570222	2026-04-27 21:31:47.516158	\N	2RGP	A	T790M,L858R	8	t	COMPLETED	\N	\N
38	HqYvK5_Mas4	2026-04-28 01:53:58.871968	2026-04-28 01:54:38.969984	P00533	2RGP	A	T790M	8	t	COMPLETED	\N	\N
15	W0jiPprs6ek	2026-04-27 21:50:22.522857	2026-04-27 21:53:37.832762	P00533	2RGP	A	L858R	8	f	COMPLETED	\N	\N
66	pUjOUa9hp0k	2026-04-28 05:25:20.317087	2026-04-28 05:26:06.512859	P36888	4XUF	A	D835V	8	t	COMPLETED	\N	\N
16	Vmz-Gr2Vc5c	2026-04-27 21:57:28.007078	2026-04-27 22:01:52.8574	P00533	2ITY	A	T790M	8	t	COMPLETED	\N	\N
39	hvrkQUthxVM	2026-04-28 01:59:08.758189	2026-04-28 01:59:27.747846	P00533	2ITY	A	T790M	8	t	COMPLETED	\N	\N
17	6WWZJt86iJM	2026-04-27 23:47:02.683507	2026-04-27 23:47:10.563775	P36888	4XUF	A	F691L	8	t	COMPLETED	\N	\N
40	g0EJvvWe2BI	2026-04-28 02:26:45.349446	2026-04-28 02:26:56.078469	P00533	2ITY	A		8	t	COMPLETED	\N	\N
18	LzfXNGJ8oUU	2026-04-28 00:04:57.402107	2026-04-28 00:05:04.89336	P00533	2RGP	A	T790M	8	t	COMPLETED	\N	\N
67	zg71LtOdzwM	2026-04-28 05:27:17.674321	2026-04-28 05:27:45.288196	P00533	2ITY	A	T790M	8	t	COMPLETED	\N	\N
41	h9iR_pAg_Dw	2026-04-28 02:30:47.986651	2026-04-28 02:31:04.126742	P00533	2RGP	A		8	t	FAILED	cannot access local variable 'pdb_id' where it is not associated with a value	\N
42	QeiNB-KXZJM	2026-04-28 02:36:09.173124	2026-04-28 02:36:40.044619	P00533	2RGP	A		8	t	COMPLETED	\N	\N
19	PFuJNa0F-w4	2026-04-28 00:07:38.362231	2026-04-28 00:14:07.477873	P00533	2RGP	A	T790M	8	t	COMPLETED	\N	\N
20	pV2tLL10Jm8	2026-04-28 00:12:15.635216	2026-04-28 00:17:09.155642	P00533	2RGP	A	T790M	8	t	COMPLETED	\N	\N
21	NhIM2YrXvu0	2026-04-28 00:13:24.755818	2026-04-28 00:19:51.128686	P10721	1T46	A	T670I,D816V,V654A	8	t	COMPLETED	\N	\N
22	3nsGFX1u87w	2026-04-28 00:23:18.007729	2026-04-28 00:23:18.293973	P08922	3ZBF	A	T790M,L858R,C797S	8	t	RUNNING	\N	\N
68	Aa_9w6k9QxA	2026-04-28 05:30:36.703468	2026-04-28 05:33:59.950199	P00533	2ITY	A	T790M	8	t	COMPLETED	\N	\N
43	feOQOYif67Q	2026-04-28 02:42:09.645912	2026-04-28 02:42:18.076007	\N	2RGP	A		8	t	COMPLETED	\N	\N
23	notNfO7J_Tw	2026-04-28 00:32:29.141181	2026-04-28 00:32:57.41393	P08922	3ZBF	A		8	t	COMPLETED	\N	\N
69	qZhzHHNFPpI	2026-04-28 05:31:08.674102	2026-04-28 05:35:35.383637	P00533	2ITY	A	T790M,L858R	8	t	COMPLETED	\N	\N
24	97S4I8dbyp4	2026-04-28 00:34:47.622002	2026-04-28 00:35:25.361415	P08922	3ZBF	A	T790M,L858R,C797S	8	t	COMPLETED	\N	\N
44	_vi42Ojn2lU	2026-04-28 02:44:22.544334	2026-04-28 02:44:53.085774	\N	2RGP	A		8	t	COMPLETED	\N	\N
25	TG2fXuZEffs	2026-04-28 00:53:43.017177	2026-04-28 00:54:24.426545	P00533	2RGP	A	T790M	8	t	COMPLETED	\N	\N
45	4g00RfQ5_mU	2026-04-28 02:45:38.199436	2026-04-28 02:45:47.815819	P08922	3ZBF	A		8	t	COMPLETED	\N	\N
27	J4_7DmobeMw	2026-04-28 00:54:30.18406	2026-04-28 00:54:30.65158	\N	USR_A939E170	A		8	t	FAILED	User-uploaded PDB 'USR_A939E170' not found at /root/.deltadock/pdb/USR_A939E170.pdb. The upload may have been on a different machine, or the cache was cleared.	\N
26	JWSyVM0D9NM	2026-04-28 00:54:24.449802	2026-04-28 00:54:47.152574	P00533	2RGP	A	T790M	8	t	COMPLETED	\N	\N
46	EmAETSIdVb0	2026-04-28 02:46:55.069759	2026-04-28 02:49:09.973722	P01116	4OBE	A	Q61H	32	t	COMPLETED	\N	\N
71	NYiqqXPNJmU	2026-04-28 05:39:19.991028	2026-04-28 05:39:20.830536	P01116	4OBE	A	G12C	8	t	FAILED	prep_step=fix_pdb pdb=4OBE chain=A: PrepError: No ATOM lines kept after cleaning /root/.deltadock/pdb/4OBE.pdb	\N
28	s6KJAxn11yA	2026-04-28 00:54:51.81545	2026-04-28 00:54:52.164775	\N	USR_084B34F4	A		8	t	FAILED	User-uploaded PDB 'USR_084B34F4' not found at /root/.deltadock/pdb/USR_084B34F4.pdb. The upload may have been on a different machine, or the cache was cleared.	\N
47	L2Uhejwz8P8	2026-04-28 03:14:38.643565	2026-04-28 03:14:53.147192	P00519	2HYY	A		8	t	COMPLETED	\N	\N
29	JuXWDxYm3g4	2026-04-28 01:00:56.344386	2026-04-28 01:01:11.054708	\N	USR_6fdb834b	A		8	t	FAILED	User-uploaded PDB 'USR_6FDB834B' not found at /root/.deltadock/pdb/USR_6FDB834B.pdb. The upload may have been on a different machine, or the cache was cleared.	\N
30	rPZ32fZmTkk	2026-04-28 01:03:28.505381	2026-04-28 01:05:25.880475	\N	USR_1d47dbb4	A		8	t	COMPLETED	\N	\N
48	cvaNCkwGhXg	2026-04-28 03:15:09.307832	2026-04-28 03:15:30.458372	P00519	2HYY	A		8	t	COMPLETED	\N	\N
49	vrUnzzosyVw	2026-04-28 03:53:25.922494	2026-04-28 03:53:37.231455	P00533	2ITY	A		8	t	COMPLETED	\N	\N
50	Y3DgtQM33rw	2026-04-28 03:54:11.054437	2026-04-28 03:54:24.839451	P01116	4OBE	A	Q61H	8	t	COMPLETED	\N	\N
51	oH1-ewiUi6c	2026-04-28 03:54:49.146146	2026-04-28 03:54:49.98287	O75874	1T0L	A	R132C	8	t	FAILED	list index out of range	\N
52	g3RJsUyS2EI	2026-04-28 03:56:04.094804	2026-04-28 03:56:50.372893	P36888	4XUF	A	D835V	8	t	COMPLETED	\N	\N
78	4yQzxdp7JRo	2026-04-28 05:39:24.736383	2026-04-28 05:39:24.736398	P36888	4XUF	A	F691L	8	t	PENDING	\N	\N
79	-vyF9hXKPdY	2026-04-28 05:39:27.297234	2026-04-28 05:39:27.297252	P10721	1T46	A	T670I	8	t	PENDING	\N	\N
53	nIxWAtZdo7E	2026-04-28 04:14:32.485029	2026-04-28 04:14:50.104233	P36888	4XUF	A	D835V	8	t	COMPLETED	\N	\N
54	sKbqZrImikQ	2026-04-28 04:16:40.536275	2026-04-28 04:16:57.154466	P36888	4XUF	A	D835V	8	t	COMPLETED	\N	\N
77	39bCtVwca-Q	2026-04-28 05:39:23.471019	2026-04-28 05:41:44.30518	P08581	2WGJ	A	Y1230H	8	t	COMPLETED	\N	\N
73	IbXj2T0DZGg	2026-04-28 05:39:20.829114	2026-04-28 05:41:52.112404	P00519	2HYY	A	T315I	8	t	COMPLETED	\N	\N
55	OkqgdHfWL9A	2026-04-28 04:17:45.444264	2026-04-28 04:18:02.302116	P36888	4XUF	A	D835V	8	t	COMPLETED	\N	\N
72	vh7Y5EsIbOM	2026-04-28 05:39:20.427947	2026-04-28 05:42:16.120544	O75874	1T0L	A	R132H	8	t	COMPLETED	\N	\N
80	ixIj6Axi35o	2026-04-28 05:40:37.90139	2026-04-28 05:43:16.132602	P00533	2ITY	A	T790M	8	t	COMPLETED	\N	\N
56	L4VMNRW0mJs	2026-04-28 04:21:37.774006	2026-04-28 04:21:54.985551	P36888	4XUF	A	D835V	8	t	COMPLETED	\N	\N
76	hQRz2SINSs8	2026-04-28 05:39:22.626524	2026-04-28 05:43:35.228633	P08922	3ZBF	A	G2032R	8	t	COMPLETED	\N	\N
74	sX1JY_b-W5Q	2026-04-28 05:39:21.436693	2026-04-28 05:43:37.740839	P04626	3PP0	A	L755S	8	t	COMPLETED	\N	\N
57	mQd20E2nxN8	2026-04-28 04:25:36.073816	2026-04-28 04:26:18.779545	P36888	4XUF	A	D835V	8	t	COMPLETED	\N	\N
75	_OCNlu7myv8	2026-04-28 05:39:21.852002	2026-04-28 05:44:45.960886	Q9UM73	2XP2	A	L1196M	8	t	COMPLETED	\N	\N
58	o6rgpCgj790	2026-04-28 04:55:43.016364	2026-04-28 04:56:15.409459	P36888	4XUF	A	D835V	8	t	COMPLETED	\N	\N
59	yJsgRT1FlxA	2026-04-28 04:57:14.955458	2026-04-28 04:57:37.005578	O75874	1T0L	A	R132C	8	t	COMPLETED	\N	\N
60	ddXqiR0hRME	2026-04-28 05:01:44.220093	2026-04-28 05:02:16.633013	P36888	4XUF	A	D835V	8	t	COMPLETED	\N	\N
70	Ee2b141GlUc	2026-04-28 05:39:19.225861	2026-04-28 05:41:00.193786	P00533	2ITY	A	T790M	8	t	COMPLETED	\N	\N
81	Q3NQR8IMHhw	2026-04-28 05:40:58.57787	2026-04-28 05:40:58.577886	O75874	1T0L	A	R132H	8	t	PENDING	\N	\N
102	l1b9t0EmjuY	2026-04-28 05:55:45.70945	2026-04-28 05:56:02.261065	O75874	1T0L	A	R132H	8	t	FAILED	prep_step=fix_pdb pdb=1T0L chain=A: PrepError: No ATOM lines kept after cleaning /root/.deltadock/pdb/1T0L.pdb	\N
82	c1srzFByBj8	2026-04-28 05:41:00.874435	2026-04-28 05:44:11.500746	P00519	2HYY	A	T315I	8	t	COMPLETED	\N	\N
87	70uDtbBeXhM	2026-04-28 05:43:18.619923	2026-04-28 05:45:38.800043	P00533	2ITY	A	T790M	8	t	COMPLETED	\N	\N
103	M00SrkGTKcY	2026-04-28 05:55:54.833414	2026-04-28 05:57:56.863753	P00519	2HYY	A	T315I	8	t	COMPLETED	\N	\N
149	GwAzONRjLPg	2026-04-28 12:56:58.951317	2026-04-28 12:57:02.269416	P00533	2ITY	A		8	t	FAILED	prep_step=fetch_pdb pdb=2ITY: FetchError: Downloaded 2ITY from RCSB but all 3 attempts failed: wrote file but on-disk read found no ATOM lines. Cache cleared.	\N
108	QuAwSdMMzX4	2026-04-28 06:03:46.55098	2026-04-28 06:05:47.746461	O75874	1T0L	A	R132H	8	t	COMPLETED	\N	\N
112	45j22zTo8OM	2026-04-28 06:04:15.409754	2026-04-28 06:07:28.425319	P04626	3PP0	A	L755S	8	t	COMPLETED	\N	\N
144	1gPkAkWN0Jo	2026-04-28 12:56:50.511109	2026-04-28 12:57:02.697643	P00533	2ITY	A		8	t	FAILED	prep_step=fix_pdb pdb=2ITY chain=A: ValueError: could not convert string to float: ' -12.ATO'	\N
116	TNzNL8uxOYk	2026-04-28 06:09:07.320985	2026-04-28 06:09:13.473404	P00519	2HYY	A	T315I	8	t	FAILED	prep_step=fix_pdb pdb=2HYY chain=A: ValueError: could not convert string to float: '  '	\N
156	SobaREHWGv0	2026-04-28 12:57:06.102812	2026-04-28 12:57:06.10283	P00533	2ITY	A		8	t	PENDING	\N	\N
120	ugAhq5NUwCM	2026-04-28 06:14:26.597115	2026-04-28 06:15:07.97927	P00519	2HYY	A	T315I	8	t	COMPLETED	\N	\N
157	iEUva8cNuFc	2026-04-28 12:57:06.718577	2026-04-28 12:57:06.718602	P00533	2ITY	A		8	t	PENDING	\N	\N
124	5ai1myyulIU	2026-04-28 06:37:40.754515	2026-04-28 06:37:57.020246	P00519	2HYY	A	T315I,E255K	8	t	FAILED	prep_step=fix_pdb pdb=2HYY chain=A: PrepError: No ATOM lines kept after cleaning /root/.deltadock/pdb/2HYY.pdb	\N
146	T52dEdXEaWo	2026-04-28 12:56:55.426207	2026-04-28 12:58:17.531355	P00533	2ITY	A		8	t	COMPLETED	\N	\N
128	j_u2Tgo073s	2026-04-28 07:31:21.660471	2026-04-28 07:34:49.285088	P00533	2ITY	A	T790M,L858R	8	t	COMPLETED	\N	\N
129	0Hazuo-RayE	2026-04-28 07:31:33.224969	2026-04-28 07:35:00.157831	P00533	2ITY	A	T790M,L858R	8	t	COMPLETED	\N	\N
137	je-OLEr4kg0	2026-04-28 11:53:22.533466	2026-04-28 11:53:22.961136	P00533	2ITY	A	T790M	32	t	COMPLETED	\N	\N
158	t1bg91kgeE8	2026-04-28 12:57:38.167491	2026-04-28 12:59:45.735886	P00533	2ITY	A		8	t	COMPLETED	\N	\N
163	8ZiNtUVFMsU	2026-04-28 12:58:03.195406	2026-04-28 12:59:47.307692	P00533	2ITY	A		8	t	COMPLETED	\N	\N
162	W5dgE016n40	2026-04-28 12:57:58.186758	2026-04-28 13:00:15.823919	P00533	2ITY	A		8	t	COMPLETED	\N	\N
169	uzkouGHo4n0	2026-04-28 14:36:36.587767	2026-04-28 14:37:12.13121	P00519	2HYY	A	Y253H	8	t	COMPLETED	\N	\N
173	fcDWZ8PbI08	2026-04-28 16:01:04.973691	2026-04-28 16:01:24.093521	\N	9IAY	A		8	t	COMPLETED	\N	\N
175	wg7M-VZGkcI	2026-04-28 16:02:07.612261	2026-04-28 16:02:47.260521	P00533	2ITY	A	T790M	8	t	COMPLETED	\N	\N
177	Dp1JxftkD7s	2026-04-28 16:02:42.314978	2026-04-28 16:02:59.925305	\N	3ZLT	A		8	t	COMPLETED	\N	\N
180	AGpl6z_Sqm0	2026-04-28 16:11:01.99036	2026-04-28 16:16:15.521086	P01116	4OBE	A	G12V,G12D	8	t	COMPLETED	\N	\N
184	ajQcd2_TM_A	2026-04-28 16:30:04.935136	2026-04-28 16:31:02.645126	P01116	4OBE	A	G12C	8	t	COMPLETED	\N	\N
104	7qa8VS2aHNw	2026-04-28 05:55:56.145298	2026-04-28 05:58:00.51971	P36888	4XUF	A	F691L	8	t	COMPLETED	\N	\N
84	rc5jlwZDyrA	2026-04-28 05:41:45.83977	2026-04-28 05:44:25.892308	P00533	2ITY	A	T790M	8	t	COMPLETED	\N	\N
83	ruxX3jHkmgw	2026-04-28 05:41:20.932237	2026-04-28 05:45:53.365143	P04626	3PP0	A	L755S	8	t	COMPLETED	\N	\N
145	iaGfNGeBPYs	2026-04-28 12:56:54.594828	2026-04-28 12:57:02.26664	P00533	2ITY	A		8	t	FAILED	prep_step=fetch_pdb pdb=2ITY: FetchError: Downloaded 2ITY from RCSB but all 3 attempts failed: wrote file but on-disk read found no ATOM lines. Cache cleared.	\N
150	yoCniODwuek	2026-04-28 12:57:00.591498	2026-04-28 12:57:02.690296	P00533	2ITY	A		8	t	FAILED	prep_step=fix_pdb pdb=2ITY chain=A: ValueError: could not convert string to float: ' -12.ATO'	\N
109	y2DuUQ5u34E	2026-04-28 06:03:55.518963	2026-04-28 06:07:09.953287	P15056	4WO5	A	V600E	8	t	COMPLETED	\N	\N
113	BdoAu7l6fIs	2026-04-28 06:04:16.342803	2026-04-28 06:07:18.211309	P01116	4OBE	A	G12C	8	t	COMPLETED	\N	\N
117	YzpGz1J01m4	2026-04-28 06:09:23.514906	2026-04-28 06:12:32.963851	P36888	4XUF	A	F691L,D835V	8	t	COMPLETED	\N	\N
121	E5A7moGUWN4	2026-04-28 06:24:40.533845	2026-04-28 06:27:32.138895	P36888	4XUF	A	D835Y	8	t	COMPLETED	\N	\N
125	51G5nOVzOQI	2026-04-28 06:40:28.583684	2026-04-28 06:41:18.42205	P00519	2HYY	A	T315I	8	t	COMPLETED	\N	\N
130	yEBzqA5BkAs	2026-04-28 07:31:33.817016	2026-04-28 07:31:33.817041	P10721	1T46	A	T670I	8	t	PENDING	\N	\N
131	OVOvBbQZNE0	2026-04-28 07:31:34.487825	2026-04-28 07:31:34.48784	Q9UM73	2XP2	A	L1196M,G1202R	8	t	PENDING	\N	\N
132	VKf8kw3-FQM	2026-04-28 07:31:34.932904	2026-04-28 07:31:34.932929	P01116	4OBE	A	G12C	8	t	PENDING	\N	\N
133	EtS4ZmFNzHc	2026-04-28 07:31:35.401369	2026-04-28 07:31:35.401381	P15056	4WO5	A	V600E	8	t	PENDING	\N	\N
134	qB0phsxo8Cs	2026-04-28 07:31:35.844745	2026-04-28 07:31:35.844757	P36888	4XUF	A	D835V	8	t	PENDING	\N	\N
153	kCPxT5S0YWs	2026-04-28 12:57:04.074006	2026-04-28 12:58:04.379466	P00533	2ITY	A		8	t	COMPLETED	\N	\N
143	xARdjF8AFfU	2026-04-28 11:59:41.240725	2026-04-28 12:00:09.765337	P00533	2ITY	A		8	t	COMPLETED	\N	\N
154	clo6SxKyeTw	2026-04-28 12:57:04.835249	2026-04-28 12:58:17.611037	P00533	2ITY	A		8	t	COMPLETED	\N	\N
152	mwQLGb168i4	2026-04-28 12:57:03.050706	2026-04-28 12:58:18.303304	P00533	2ITY	A		8	t	COMPLETED	\N	\N
160	3RvOU228a4Q	2026-04-28 12:57:48.223063	2026-04-28 13:00:15.175789	P00533	2ITY	A		8	t	COMPLETED	\N	\N
170	Ab5Zhyn39lk	2026-04-28 15:57:45.571365	2026-04-28 15:57:46.888787	P01116	4OBE	A		8	t	FAILED	prep_step=fix_pdb pdb=4OBE chain=A: PrepError: No ATOM lines kept after cleaning /root/.deltadock/pdb/4OBE.pdb	\N
174	0eOt2WwSIeE	2026-04-28 16:01:04.97255	2026-04-28 16:01:43.696958	P00533	2ITY	A	T790M	8	t	COMPLETED	\N	\N
178	xuIiQAgT3Xs	2026-04-28 16:04:12.531132	2026-04-28 16:04:32.836388	P00533	2ITY	A	T790M	8	t	COMPLETED	\N	\N
181	C9pKCo3T_ug	2026-04-28 16:11:01.987583	2026-04-28 16:16:29.242541	P00533	2ITY	A	T790M,C797S	8	t	COMPLETED	\N	\N
185	9CVnhjw0ZCM	2026-04-28 16:33:56.061598	2026-04-28 16:34:38.840941	P00533	2ITY	A	T790M	8	t	COMPLETED	\N	\N
85	sX5t4lBssRo	2026-04-28 05:41:52.94776	2026-04-28 05:41:52.947772	P01116	4OBE	A	G12C	8	t	PENDING	\N	\N
105	j9Aoa3gWGRs	2026-04-28 05:55:57.612271	2026-04-28 05:55:58.424832	P04626	3PP0	A	L755S	8	t	RUNNING	\N	\N
86	jELB27fgYpY	2026-04-28 05:42:28.663594	2026-04-28 05:45:22.01287	P00533	2ITY	A	T790M	8	t	COMPLETED	\N	\N
110	fspPcKssLBc	2026-04-28 06:03:56.958826	2026-04-28 06:04:02.928103	P00519	2HYY	A	T315I	8	t	FAILED	prep_step=fetch_pdb pdb=2HYY: FetchError: Downloaded 2HYY from RCSB but content has no ATOM records (first 200 chars: b'HEADER    TRANSFERASE                             08-AUG-06   2HYY              \\nTITLE     HUMAN ABL KINASE DOMAIN IN COMPLEX WITH IMATINIB (STI571, GLIVEC)     \\nCOMPND    MOL_ID: 1;                  '). Cache cleared.	\N
147	iweoZ6qZM_Y	2026-04-28 12:56:57.012289	2026-04-28 12:58:04.987551	P00533	2ITY	A		8	t	COMPLETED	\N	\N
118	KNKjC8Lss7w	2026-04-28 06:09:24.598833	2026-04-28 06:09:25.309229	P04626	3PP0	A	L755S	8	t	RUNNING	\N	\N
114	6US9djKxqZk	2026-04-28 06:08:56.874317	2026-04-28 06:11:35.188914	O75874	1T0L	A	R132H	8	t	COMPLETED	\N	\N
122	07SXbjawxt4	2026-04-28 06:30:26.549192	2026-04-28 06:31:12.081391	P36888	4XUF	A	D835Y	8	t	COMPLETED	\N	\N
151	Mu1AD0oi4yY	2026-04-28 12:57:02.007413	2026-04-28 12:58:19.740362	P00533	2ITY	A		8	t	COMPLETED	\N	\N
165	8k0_mJIma7A	2026-04-28 12:58:13.230791	2026-04-28 12:58:13.230804	P00533	2ITY	A		8	t	PENDING	\N	\N
126	HKCv3lAjfxQ	2026-04-28 06:41:55.370569	2026-04-28 06:48:56.751232	P00519	2HYY	A	T315I,E255K,Y253H	8	t	COMPLETED	\N	\N
166	wgAkiK9nWM8	2026-04-28 12:58:28.67502	2026-04-28 12:58:28.67504	P00533	2ITY	A		8	t	PENDING	\N	\N
135	VacIJ9WVJLw	2026-04-28 11:53:02.324727	2026-04-28 11:53:03.401606	P00533	2ITY	A	T790M	32	t	COMPLETED	\N	\N
161	0a8aZYIxeis	2026-04-28 12:57:53.159309	2026-04-28 12:59:46.279542	P00533	2ITY	A		8	t	COMPLETED	\N	\N
164	_XEHLsjavcA	2026-04-28 12:58:08.214698	2026-04-28 12:59:48.043901	P00533	2ITY	A		8	t	COMPLETED	\N	\N
139	1R2cHyXOndk	2026-04-28 11:53:23.720964	2026-04-28 11:53:24.153762	P00533	2ITY	A	T790M	32	t	COMPLETED	\N	\N
138	x2GHR_itbZ4	2026-04-28 11:53:23.213531	2026-04-28 11:53:24.239298	P00533	2ITY	A	T790M	32	t	COMPLETED	\N	\N
171	y5JwKrNlw3Y	2026-04-28 15:57:45.56429	2026-04-28 15:58:05.102225	\N	3X34	A		8	t	COMPLETED	\N	\N
140	QN0YK6rXARY	2026-04-28 11:53:24.551184	2026-04-28 11:53:25.195463	P00533	ZZZZ	A	T790M	32	t	FAILED	prep_step=fetch_pdb pdb=ZZZZ: FetchError: Downloaded ZZZZ from RCSB but all 3 attempts failed: HTTP 404: <!DOCTYPE html>\n<html>\n<head>\n    <meta charset="UTF-8">\n    <title>404 Not Found</title>\n    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">\n   . Cache cleared.	\N
176	ZpnZaLdGM2o	2026-04-28 16:02:42.311718	2026-04-28 16:03:25.392819	P00533	2ITY	A	T790M,L858R,C797S	8	t	COMPLETED	\N	\N
141	FL4c7uWAb-o	2026-04-28 11:53:25.385361	2026-04-28 11:55:42.796081	P00533	2ITY	A	A790A	32	t	COMPLETED	\N	\N
142	1owu-bCcSW4	2026-04-28 11:53:26.338958	2026-04-28 11:56:49.340379	P00533	2ITY	A	T790M,T790M	32	t	COMPLETED	\N	\N
182	GbRYNbvezEc	2026-04-28 16:11:43.066273	2026-04-28 16:18:47.062743	P00533	2ITY	A	T790M,L858R,C797S	8	t	COMPLETED	\N	\N
186	a6-2RVRruo0	2026-04-28 17:36:15.591326	2026-04-28 17:37:03.14106	\N	5D8V	A	C481S	8	t	COMPLETED	\N	\N
100	7R-7MBbGjNw	2026-04-28 05:46:24.556303	2026-04-28 05:52:32.503639	P42336	4JPS	A	H1047R	8	t	COMPLETED	\N	\N
89	mrlLUH0zPrA	2026-04-28 05:43:35.832467	2026-04-28 05:43:35.832479	P00519	2HYY	A	T315I	8	t	PENDING	\N	\N
101	dnNQgn8ZMc8	2026-04-28 05:46:46.520275	2026-04-28 05:53:59.735759	P42336	4JPS	A	H1047R	8	t	COMPLETED	\N	\N
91	8xqd1wr9aLs	2026-04-28 05:44:14.380203	2026-04-28 05:44:14.380216	P10721	1T46	A	T670I	8	t	PENDING	\N	\N
106	CBf4EOQ-YF0	2026-04-28 05:55:58.829728	2026-04-28 05:56:02.891151	P15056	4WO5	A	V600E	8	t	FAILED	prep_step=fix_pdb pdb=4WO5 chain=A: ValueError: could not convert string to float: ' '	\N
148	c4daEbvQVQk	2026-04-28 12:56:58.493978	2026-04-28 12:57:02.601601	P00533	2ITY	A		8	t	FAILED	prep_step=fix_pdb pdb=2ITY chain=A: FileNotFoundError: [Errno 2] No such file or directory: '/root/.deltadock/pdb/2ITY.pdb'	\N
107	5TnvauxLQP0	2026-04-28 05:56:21.096819	2026-04-28 05:59:31.248337	P01116	4OBE	A	G12C	8	t	COMPLETED	\N	\N
94	q_Dido9bc-w	2026-04-28 05:44:45.853523	2026-04-28 05:44:45.853534	P04626	3PP0	A	L755S	8	t	PENDING	\N	\N
111	qINkZxHPqfQ	2026-04-28 06:04:14.845055	2026-04-28 06:06:01.033066	P36888	4XUF	A	F691L	8	t	COMPLETED	\N	\N
115	zJS0FrOkqEU	2026-04-28 06:09:06.085902	2026-04-28 06:09:07.107371	P15056	4WO5	A	V600E	8	t	RUNNING	\N	\N
98	Hj95GJ0ei18	2026-04-28 05:45:39.432278	2026-04-28 05:45:39.432291	Q06187	5P9J	A	C481S	8	t	PENDING	\N	\N
119	oRZPUwTYP7Y	2026-04-28 06:09:25.467559	2026-04-28 06:09:26.700629	P01116	4OBE	A	G12C	8	t	RUNNING	\N	\N
99	PyPAy_z-0ro	2026-04-28 05:46:09.184468	2026-04-28 05:46:09.184482	P15056	4WO5	A	V600E	8	t	PENDING	\N	\N
155	MJh90iqz0UU	2026-04-28 12:57:05.390724	2026-04-28 12:58:18.763155	P00533	2ITY	A		8	t	COMPLETED	\N	\N
90	DWv1daqndEs	2026-04-28 05:43:38.3876	2026-04-28 05:47:06.921134	P10721	1T46	A	T670I	8	t	COMPLETED	\N	\N
159	g0q1eKeKxrs	2026-04-28 12:57:43.118745	2026-04-28 13:00:16.49974	P00533	2ITY	A		8	t	COMPLETED	\N	\N
88	R-lQbTstIpo	2026-04-28 05:43:19.283634	2026-04-28 05:47:26.525135	P01116	4OBE	A	G12C	8	t	COMPLETED	\N	\N
92	ctvKhpehld8	2026-04-28 05:44:15.47219	2026-04-28 05:47:39.037281	P36888	4XUF	A	F691L	8	t	COMPLETED	\N	\N
93	Rkqwmnqvf4A	2026-04-28 05:44:42.614744	2026-04-28 05:47:49.907662	O75874	1T0L	A	R132H	8	t	COMPLETED	\N	\N
97	FUS1iADB_Lw	2026-04-28 05:45:32.720237	2026-04-28 05:48:02.197535	P08581	2WGJ	A	Y1230H	8	t	COMPLETED	\N	\N
95	Tp1PUxvbP8M	2026-04-28 05:44:46.968783	2026-04-28 05:49:08.441662	Q9UM73	2XP2	A	L1196M	8	t	COMPLETED	\N	\N
96	GtEqY0qNJbQ	2026-04-28 05:45:32.148646	2026-04-28 05:49:29.025587	P08922	3ZBF	A	G2032R	8	t	COMPLETED	\N	\N
123	bcnYLIvAv18	2026-04-28 06:31:12.543806	2026-04-28 06:31:47.081374	P36888	4XUF	A	D835Y	8	t	COMPLETED	\N	\N
167	btpfhC5LugA	2026-04-28 14:20:58.270637	2026-04-28 14:21:25.630857	P08581	2WGJ	A	Y1230H	8	t	COMPLETED	\N	\N
127	cl821BxiDSU	2026-04-28 06:56:07.108969	2026-04-28 06:56:44.681273	P00533	2ITY	A	T790M,L858R	8	t	COMPLETED	\N	\N
168	c8S1g2p58es	2026-04-28 14:22:16.972344	2026-04-28 14:26:47.301331	P08581	2WGJ	A	Y1230H,D1228V	8	t	COMPLETED	\N	\N
136	vFO926PW7i0	2026-04-28 11:53:03.574311	2026-04-28 11:53:04.638557	P00533	2ITY	A	T790M	32	t	COMPLETED	\N	\N
172	cho1XB60imo	2026-04-28 15:57:45.555215	2026-04-28 15:58:30.883582	P00533	2ITY	A	T790M	8	t	COMPLETED	\N	\N
179	WH7N08vz_Ok	2026-04-28 16:04:12.538363	2026-04-28 16:04:31.963397	P01116	4OBE	A	G12C	8	t	COMPLETED	\N	\N
183	Uw3IYl6kaLQ	2026-04-28 16:30:04.877921	2026-04-28 16:30:12.225629	P00533	2ITY	A	T790M	8	t	FAILED	prep_step=fix_pdb pdb=2ITY chain=A: IndexError: list index out of range	\N
187	acOR4dHAwMI	2026-04-28 18:13:48.175391	2026-04-28 18:14:25.623838	P01116	4OBE	A	Q61H	8	t	COMPLETED	\N	\N
\.


--
-- Data for Name: schema_migrations; Type: TABLE DATA; Schema: realtime; Owner: -
--

COPY "realtime"."schema_migrations" ("version", "inserted_at") FROM stdin;
20211116024918	2026-04-27 20:40:44
20211116045059	2026-04-27 20:40:44
20211116050929	2026-04-27 20:40:45
20211116051442	2026-04-27 20:40:45
20211116212300	2026-04-27 20:40:45
20211116213355	2026-04-27 20:40:45
20211116213934	2026-04-27 20:40:45
20211116214523	2026-04-27 20:40:45
20211122062447	2026-04-27 20:40:45
20211124070109	2026-04-27 20:40:46
20211202204204	2026-04-27 20:40:46
20211202204605	2026-04-27 20:40:46
20211210212804	2026-04-27 20:40:46
20211228014915	2026-04-27 20:40:47
20220107221237	2026-04-27 20:40:47
20220228202821	2026-04-27 20:40:47
20220312004840	2026-04-27 20:40:47
20220603231003	2026-04-27 20:40:47
20220603232444	2026-04-27 20:40:47
20220615214548	2026-04-27 20:40:47
20220712093339	2026-04-27 20:40:48
20220908172859	2026-04-27 20:40:48
20220916233421	2026-04-27 20:40:48
20230119133233	2026-04-27 20:40:48
20230128025114	2026-04-27 20:40:48
20230128025212	2026-04-27 20:40:48
20230227211149	2026-04-27 20:40:49
20230228184745	2026-04-27 20:40:49
20230308225145	2026-04-27 20:40:49
20230328144023	2026-04-27 20:40:49
20231018144023	2026-04-27 20:40:49
20231204144023	2026-04-27 20:40:49
20231204144024	2026-04-27 20:40:49
20231204144025	2026-04-27 20:40:50
20240108234812	2026-04-27 20:40:50
20240109165339	2026-04-27 20:40:50
20240227174441	2026-04-27 20:40:50
20240311171622	2026-04-27 20:40:50
20240321100241	2026-04-27 20:40:51
20240401105812	2026-04-27 20:40:51
20240418121054	2026-04-27 20:40:51
20240523004032	2026-04-27 20:40:52
20240618124746	2026-04-27 20:40:52
20240801235015	2026-04-27 20:40:52
20240805133720	2026-04-27 20:40:52
20240827160934	2026-04-27 20:40:52
20240919163303	2026-04-27 20:40:52
20240919163305	2026-04-27 20:40:53
20241019105805	2026-04-27 20:40:53
20241030150047	2026-04-27 20:40:53
20241108114728	2026-04-27 20:40:54
20241121104152	2026-04-27 20:40:54
20241130184212	2026-04-27 20:40:54
20241220035512	2026-04-27 20:40:54
20241220123912	2026-04-27 20:40:54
20241224161212	2026-04-27 20:40:54
20250107150512	2026-04-27 20:40:54
20250110162412	2026-04-27 20:40:54
20250123174212	2026-04-27 20:40:55
20250128220012	2026-04-27 20:40:55
20250506224012	2026-04-27 20:40:55
20250523164012	2026-04-27 20:40:55
20250714121412	2026-04-27 20:40:55
20250905041441	2026-04-27 20:40:55
20251103001201	2026-04-27 20:40:55
20251120212548	2026-04-27 20:40:56
20251120215549	2026-04-27 20:40:56
20260218120000	2026-04-27 20:40:56
20260326120000	2026-04-27 20:40:56
\.


--
-- Data for Name: subscription; Type: TABLE DATA; Schema: realtime; Owner: -
--

COPY "realtime"."subscription" ("id", "subscription_id", "entity", "filters", "claims", "created_at", "action_filter") FROM stdin;
\.


--
-- Data for Name: buckets; Type: TABLE DATA; Schema: storage; Owner: -
--

COPY "storage"."buckets" ("id", "name", "owner", "created_at", "updated_at", "public", "avif_autodetection", "file_size_limit", "allowed_mime_types", "owner_id", "type") FROM stdin;
\.


--
-- Data for Name: buckets_analytics; Type: TABLE DATA; Schema: storage; Owner: -
--

COPY "storage"."buckets_analytics" ("name", "type", "format", "created_at", "updated_at", "id", "deleted_at") FROM stdin;
\.


--
-- Data for Name: buckets_vectors; Type: TABLE DATA; Schema: storage; Owner: -
--

COPY "storage"."buckets_vectors" ("id", "type", "created_at", "updated_at") FROM stdin;
\.


--
-- Data for Name: migrations; Type: TABLE DATA; Schema: storage; Owner: -
--

COPY "storage"."migrations" ("id", "name", "hash", "executed_at") FROM stdin;
0	create-migrations-table	e18db593bcde2aca2a408c4d1100f6abba2195df	2026-04-27 18:19:17.661846
1	initialmigration	6ab16121fbaa08bbd11b712d05f358f9b555d777	2026-04-27 18:19:17.693762
2	storage-schema	f6a1fa2c93cbcd16d4e487b362e45fca157a8dbd	2026-04-27 18:19:17.698591
3	pathtoken-column	2cb1b0004b817b29d5b0a971af16bafeede4b70d	2026-04-27 18:19:17.718365
4	add-migrations-rls	427c5b63fe1c5937495d9c635c263ee7a5905058	2026-04-27 18:19:17.727539
5	add-size-functions	79e081a1455b63666c1294a440f8ad4b1e6a7f84	2026-04-27 18:19:17.72977
6	change-column-name-in-get-size	ded78e2f1b5d7e616117897e6443a925965b30d2	2026-04-27 18:19:17.732425
7	add-rls-to-buckets	e7e7f86adbc51049f341dfe8d30256c1abca17aa	2026-04-27 18:19:17.73557
8	add-public-to-buckets	fd670db39ed65f9d08b01db09d6202503ca2bab3	2026-04-27 18:19:17.73783
9	fix-search-function	af597a1b590c70519b464a4ab3be54490712796b	2026-04-27 18:19:17.740298
10	search-files-search-function	b595f05e92f7e91211af1bbfe9c6a13bb3391e16	2026-04-27 18:19:17.742688
11	add-trigger-to-auto-update-updated_at-column	7425bdb14366d1739fa8a18c83100636d74dcaa2	2026-04-27 18:19:17.74603
12	add-automatic-avif-detection-flag	8e92e1266eb29518b6a4c5313ab8f29dd0d08df9	2026-04-27 18:19:17.750856
13	add-bucket-custom-limits	cce962054138135cd9a8c4bcd531598684b25e7d	2026-04-27 18:19:17.753221
14	use-bytes-for-max-size	941c41b346f9802b411f06f30e972ad4744dad27	2026-04-27 18:19:17.755673
15	add-can-insert-object-function	934146bc38ead475f4ef4b555c524ee5d66799e5	2026-04-27 18:19:17.777996
16	add-version	76debf38d3fd07dcfc747ca49096457d95b1221b	2026-04-27 18:19:17.780373
17	drop-owner-foreign-key	f1cbb288f1b7a4c1eb8c38504b80ae2a0153d101	2026-04-27 18:19:17.782665
18	add_owner_id_column_deprecate_owner	e7a511b379110b08e2f214be852c35414749fe66	2026-04-27 18:19:17.784891
19	alter-default-value-objects-id	02e5e22a78626187e00d173dc45f58fa66a4f043	2026-04-27 18:19:17.788638
20	list-objects-with-delimiter	cd694ae708e51ba82bf012bba00caf4f3b6393b7	2026-04-27 18:19:17.790971
21	s3-multipart-uploads	8c804d4a566c40cd1e4cc5b3725a664a9303657f	2026-04-27 18:19:17.79486
22	s3-multipart-uploads-big-ints	9737dc258d2397953c9953d9b86920b8be0cdb73	2026-04-27 18:19:17.807908
23	optimize-search-function	9d7e604cddc4b56a5422dc68c9313f4a1b6f132c	2026-04-27 18:19:17.814858
24	operation-function	8312e37c2bf9e76bbe841aa5fda889206d2bf8aa	2026-04-27 18:19:17.817248
25	custom-metadata	d974c6057c3db1c1f847afa0e291e6165693b990	2026-04-27 18:19:17.81972
26	objects-prefixes	215cabcb7f78121892a5a2037a09fedf9a1ae322	2026-04-27 18:19:17.822471
27	search-v2	859ba38092ac96eb3964d83bf53ccc0b141663a6	2026-04-27 18:19:17.824654
28	object-bucket-name-sorting	c73a2b5b5d4041e39705814fd3a1b95502d38ce4	2026-04-27 18:19:17.826791
29	create-prefixes	ad2c1207f76703d11a9f9007f821620017a66c21	2026-04-27 18:19:17.828893
30	update-object-levels	2be814ff05c8252fdfdc7cfb4b7f5c7e17f0bed6	2026-04-27 18:19:17.831027
31	objects-level-index	b40367c14c3440ec75f19bbce2d71e914ddd3da0	2026-04-27 18:19:17.833034
32	backward-compatible-index-on-objects	e0c37182b0f7aee3efd823298fb3c76f1042c0f7	2026-04-27 18:19:17.835043
33	backward-compatible-index-on-prefixes	b480e99ed951e0900f033ec4eb34b5bdcb4e3d49	2026-04-27 18:19:17.83705
34	optimize-search-function-v1	ca80a3dc7bfef894df17108785ce29a7fc8ee456	2026-04-27 18:19:17.838967
35	add-insert-trigger-prefixes	458fe0ffd07ec53f5e3ce9df51bfdf4861929ccc	2026-04-27 18:19:17.841022
36	optimise-existing-functions	6ae5fca6af5c55abe95369cd4f93985d1814ca8f	2026-04-27 18:19:17.843234
37	add-bucket-name-length-trigger	3944135b4e3e8b22d6d4cbb568fe3b0b51df15c1	2026-04-27 18:19:17.846321
38	iceberg-catalog-flag-on-buckets	02716b81ceec9705aed84aa1501657095b32e5c5	2026-04-27 18:19:17.850146
39	add-search-v2-sort-support	6706c5f2928846abee18461279799ad12b279b78	2026-04-27 18:19:17.859094
40	fix-prefix-race-conditions-optimized	7ad69982ae2d372b21f48fc4829ae9752c518f6b	2026-04-27 18:19:17.861603
41	add-object-level-update-trigger	07fcf1a22165849b7a029deed059ffcde08d1ae0	2026-04-27 18:19:17.864159
42	rollback-prefix-triggers	771479077764adc09e2ea2043eb627503c034cd4	2026-04-27 18:19:17.866644
43	fix-object-level	84b35d6caca9d937478ad8a797491f38b8c2979f	2026-04-27 18:19:17.869142
44	vector-bucket-type	99c20c0ffd52bb1ff1f32fb992f3b351e3ef8fb3	2026-04-27 18:19:17.871586
45	vector-buckets	049e27196d77a7cb76497a85afae669d8b230953	2026-04-27 18:19:17.874735
46	buckets-objects-grants	fedeb96d60fefd8e02ab3ded9fbde05632f84aed	2026-04-27 18:19:17.882933
47	iceberg-table-metadata	649df56855c24d8b36dd4cc1aeb8251aa9ad42c2	2026-04-27 18:19:17.885995
48	iceberg-catalog-ids	e0e8b460c609b9999ccd0df9ad14294613eed939	2026-04-27 18:19:17.888724
49	buckets-objects-grants-postgres	072b1195d0d5a2f888af6b2302a1938dd94b8b3d	2026-04-27 18:19:17.902292
50	search-v2-optimised	6323ac4f850aa14e7387eb32102869578b5bd478	2026-04-27 18:19:17.905409
51	index-backward-compatible-search	2ee395d433f76e38bcd3856debaf6e0e5b674011	2026-04-27 18:19:18.752671
52	drop-not-used-indexes-and-functions	5cc44c8696749ac11dd0dc37f2a3802075f3a171	2026-04-27 18:19:18.754296
53	drop-index-lower-name	d0cb18777d9e2a98ebe0bc5cc7a42e57ebe41854	2026-04-27 18:19:18.76273
54	drop-index-object-level	6289e048b1472da17c31a7eba1ded625a6457e67	2026-04-27 18:19:18.764436
55	prevent-direct-deletes	262a4798d5e0f2e7c8970232e03ce8be695d5819	2026-04-27 18:19:18.765794
56	fix-optimized-search-function	cb58526ebc23048049fd5bf2fd148d18b04a2073	2026-04-27 18:19:18.76905
57	s3-multipart-uploads-metadata	f127886e00d1b374fadbc7c6b31e09336aad5287	2026-04-27 18:19:18.772509
58	operation-ergonomics	00ca5d483b3fe0d522133d9002ccc5df98365120	2026-04-27 18:19:18.77487
\.


--
-- Data for Name: objects; Type: TABLE DATA; Schema: storage; Owner: -
--

COPY "storage"."objects" ("id", "bucket_id", "name", "owner", "created_at", "updated_at", "last_accessed_at", "metadata", "version", "owner_id", "user_metadata") FROM stdin;
\.


--
-- Data for Name: s3_multipart_uploads; Type: TABLE DATA; Schema: storage; Owner: -
--

COPY "storage"."s3_multipart_uploads" ("id", "in_progress_size", "upload_signature", "bucket_id", "key", "version", "owner_id", "created_at", "user_metadata", "metadata") FROM stdin;
\.


--
-- Data for Name: s3_multipart_uploads_parts; Type: TABLE DATA; Schema: storage; Owner: -
--

COPY "storage"."s3_multipart_uploads_parts" ("id", "upload_id", "size", "part_number", "bucket_id", "key", "etag", "owner_id", "version", "created_at") FROM stdin;
\.


--
-- Data for Name: vector_indexes; Type: TABLE DATA; Schema: storage; Owner: -
--

COPY "storage"."vector_indexes" ("id", "name", "bucket_id", "data_type", "dimension", "distance_metric", "metadata_configuration", "created_at", "updated_at") FROM stdin;
\.


--
-- Data for Name: secrets; Type: TABLE DATA; Schema: vault; Owner: -
--

COPY "vault"."secrets" ("id", "name", "description", "secret", "key_id", "nonce", "created_at", "updated_at") FROM stdin;
\.


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE SET; Schema: auth; Owner: -
--

SELECT pg_catalog.setval('"auth"."refresh_tokens_id_seq"', 1, false);


--
-- Name: compound_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('"public"."compound_id_seq"', 207, true);


--
-- Name: dockingresult_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('"public"."dockingresult_id_seq"', 337, true);


--
-- Name: job_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('"public"."job_id_seq"', 187, true);


--
-- Name: subscription_id_seq; Type: SEQUENCE SET; Schema: realtime; Owner: -
--

SELECT pg_catalog.setval('"realtime"."subscription_id_seq"', 1, false);


--
-- Name: mfa_amr_claims amr_id_pk; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."mfa_amr_claims"
    ADD CONSTRAINT "amr_id_pk" PRIMARY KEY ("id");


--
-- Name: audit_log_entries audit_log_entries_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."audit_log_entries"
    ADD CONSTRAINT "audit_log_entries_pkey" PRIMARY KEY ("id");


--
-- Name: custom_oauth_providers custom_oauth_providers_identifier_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."custom_oauth_providers"
    ADD CONSTRAINT "custom_oauth_providers_identifier_key" UNIQUE ("identifier");


--
-- Name: custom_oauth_providers custom_oauth_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."custom_oauth_providers"
    ADD CONSTRAINT "custom_oauth_providers_pkey" PRIMARY KEY ("id");


--
-- Name: flow_state flow_state_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."flow_state"
    ADD CONSTRAINT "flow_state_pkey" PRIMARY KEY ("id");


--
-- Name: identities identities_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."identities"
    ADD CONSTRAINT "identities_pkey" PRIMARY KEY ("id");


--
-- Name: identities identities_provider_id_provider_unique; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."identities"
    ADD CONSTRAINT "identities_provider_id_provider_unique" UNIQUE ("provider_id", "provider");


--
-- Name: instances instances_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."instances"
    ADD CONSTRAINT "instances_pkey" PRIMARY KEY ("id");


--
-- Name: mfa_amr_claims mfa_amr_claims_session_id_authentication_method_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."mfa_amr_claims"
    ADD CONSTRAINT "mfa_amr_claims_session_id_authentication_method_pkey" UNIQUE ("session_id", "authentication_method");


--
-- Name: mfa_challenges mfa_challenges_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."mfa_challenges"
    ADD CONSTRAINT "mfa_challenges_pkey" PRIMARY KEY ("id");


--
-- Name: mfa_factors mfa_factors_last_challenged_at_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."mfa_factors"
    ADD CONSTRAINT "mfa_factors_last_challenged_at_key" UNIQUE ("last_challenged_at");


--
-- Name: mfa_factors mfa_factors_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."mfa_factors"
    ADD CONSTRAINT "mfa_factors_pkey" PRIMARY KEY ("id");


--
-- Name: oauth_authorizations oauth_authorizations_authorization_code_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."oauth_authorizations"
    ADD CONSTRAINT "oauth_authorizations_authorization_code_key" UNIQUE ("authorization_code");


--
-- Name: oauth_authorizations oauth_authorizations_authorization_id_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."oauth_authorizations"
    ADD CONSTRAINT "oauth_authorizations_authorization_id_key" UNIQUE ("authorization_id");


--
-- Name: oauth_authorizations oauth_authorizations_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."oauth_authorizations"
    ADD CONSTRAINT "oauth_authorizations_pkey" PRIMARY KEY ("id");


--
-- Name: oauth_client_states oauth_client_states_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."oauth_client_states"
    ADD CONSTRAINT "oauth_client_states_pkey" PRIMARY KEY ("id");


--
-- Name: oauth_clients oauth_clients_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."oauth_clients"
    ADD CONSTRAINT "oauth_clients_pkey" PRIMARY KEY ("id");


--
-- Name: oauth_consents oauth_consents_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."oauth_consents"
    ADD CONSTRAINT "oauth_consents_pkey" PRIMARY KEY ("id");


--
-- Name: oauth_consents oauth_consents_user_client_unique; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."oauth_consents"
    ADD CONSTRAINT "oauth_consents_user_client_unique" UNIQUE ("user_id", "client_id");


--
-- Name: one_time_tokens one_time_tokens_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."one_time_tokens"
    ADD CONSTRAINT "one_time_tokens_pkey" PRIMARY KEY ("id");


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."refresh_tokens"
    ADD CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id");


--
-- Name: refresh_tokens refresh_tokens_token_unique; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."refresh_tokens"
    ADD CONSTRAINT "refresh_tokens_token_unique" UNIQUE ("token");


--
-- Name: saml_providers saml_providers_entity_id_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."saml_providers"
    ADD CONSTRAINT "saml_providers_entity_id_key" UNIQUE ("entity_id");


--
-- Name: saml_providers saml_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."saml_providers"
    ADD CONSTRAINT "saml_providers_pkey" PRIMARY KEY ("id");


--
-- Name: saml_relay_states saml_relay_states_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."saml_relay_states"
    ADD CONSTRAINT "saml_relay_states_pkey" PRIMARY KEY ("id");


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."schema_migrations"
    ADD CONSTRAINT "schema_migrations_pkey" PRIMARY KEY ("version");


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."sessions"
    ADD CONSTRAINT "sessions_pkey" PRIMARY KEY ("id");


--
-- Name: sso_domains sso_domains_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."sso_domains"
    ADD CONSTRAINT "sso_domains_pkey" PRIMARY KEY ("id");


--
-- Name: sso_providers sso_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."sso_providers"
    ADD CONSTRAINT "sso_providers_pkey" PRIMARY KEY ("id");


--
-- Name: users users_phone_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."users"
    ADD CONSTRAINT "users_phone_key" UNIQUE ("phone");


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");


--
-- Name: webauthn_challenges webauthn_challenges_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."webauthn_challenges"
    ADD CONSTRAINT "webauthn_challenges_pkey" PRIMARY KEY ("id");


--
-- Name: webauthn_credentials webauthn_credentials_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."webauthn_credentials"
    ADD CONSTRAINT "webauthn_credentials_pkey" PRIMARY KEY ("id");


--
-- Name: compound compound_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."compound"
    ADD CONSTRAINT "compound_pkey" PRIMARY KEY ("id");


--
-- Name: dockingresult dockingresult_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."dockingresult"
    ADD CONSTRAINT "dockingresult_pkey" PRIMARY KEY ("id");


--
-- Name: job job_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."job"
    ADD CONSTRAINT "job_pkey" PRIMARY KEY ("id");


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY "realtime"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id", "inserted_at");


--
-- Name: subscription pk_subscription; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY "realtime"."subscription"
    ADD CONSTRAINT "pk_subscription" PRIMARY KEY ("id");


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY "realtime"."schema_migrations"
    ADD CONSTRAINT "schema_migrations_pkey" PRIMARY KEY ("version");


--
-- Name: buckets_analytics buckets_analytics_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY "storage"."buckets_analytics"
    ADD CONSTRAINT "buckets_analytics_pkey" PRIMARY KEY ("id");


--
-- Name: buckets buckets_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY "storage"."buckets"
    ADD CONSTRAINT "buckets_pkey" PRIMARY KEY ("id");


--
-- Name: buckets_vectors buckets_vectors_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY "storage"."buckets_vectors"
    ADD CONSTRAINT "buckets_vectors_pkey" PRIMARY KEY ("id");


--
-- Name: migrations migrations_name_key; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY "storage"."migrations"
    ADD CONSTRAINT "migrations_name_key" UNIQUE ("name");


--
-- Name: migrations migrations_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY "storage"."migrations"
    ADD CONSTRAINT "migrations_pkey" PRIMARY KEY ("id");


--
-- Name: objects objects_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY "storage"."objects"
    ADD CONSTRAINT "objects_pkey" PRIMARY KEY ("id");


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY "storage"."s3_multipart_uploads_parts"
    ADD CONSTRAINT "s3_multipart_uploads_parts_pkey" PRIMARY KEY ("id");


--
-- Name: s3_multipart_uploads s3_multipart_uploads_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY "storage"."s3_multipart_uploads"
    ADD CONSTRAINT "s3_multipart_uploads_pkey" PRIMARY KEY ("id");


--
-- Name: vector_indexes vector_indexes_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY "storage"."vector_indexes"
    ADD CONSTRAINT "vector_indexes_pkey" PRIMARY KEY ("id");


--
-- Name: audit_logs_instance_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX "audit_logs_instance_id_idx" ON "auth"."audit_log_entries" USING "btree" ("instance_id");


--
-- Name: confirmation_token_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX "confirmation_token_idx" ON "auth"."users" USING "btree" ("confirmation_token") WHERE (("confirmation_token")::"text" !~ '^[0-9 ]*$'::"text");


--
-- Name: custom_oauth_providers_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX "custom_oauth_providers_created_at_idx" ON "auth"."custom_oauth_providers" USING "btree" ("created_at");


--
-- Name: custom_oauth_providers_enabled_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX "custom_oauth_providers_enabled_idx" ON "auth"."custom_oauth_providers" USING "btree" ("enabled");


--
-- Name: custom_oauth_providers_identifier_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX "custom_oauth_providers_identifier_idx" ON "auth"."custom_oauth_providers" USING "btree" ("identifier");


--
-- Name: custom_oauth_providers_provider_type_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX "custom_oauth_providers_provider_type_idx" ON "auth"."custom_oauth_providers" USING "btree" ("provider_type");


--
-- Name: email_change_token_current_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX "email_change_token_current_idx" ON "auth"."users" USING "btree" ("email_change_token_current") WHERE (("email_change_token_current")::"text" !~ '^[0-9 ]*$'::"text");


--
-- Name: email_change_token_new_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX "email_change_token_new_idx" ON "auth"."users" USING "btree" ("email_change_token_new") WHERE (("email_change_token_new")::"text" !~ '^[0-9 ]*$'::"text");


--
-- Name: factor_id_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX "factor_id_created_at_idx" ON "auth"."mfa_factors" USING "btree" ("user_id", "created_at");


--
-- Name: flow_state_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX "flow_state_created_at_idx" ON "auth"."flow_state" USING "btree" ("created_at" DESC);


--
-- Name: identities_email_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX "identities_email_idx" ON "auth"."identities" USING "btree" ("email" "text_pattern_ops");


--
-- Name: INDEX "identities_email_idx"; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON INDEX "auth"."identities_email_idx" IS 'Auth: Ensures indexed queries on the email column';


--
-- Name: identities_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX "identities_user_id_idx" ON "auth"."identities" USING "btree" ("user_id");


--
-- Name: idx_auth_code; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX "idx_auth_code" ON "auth"."flow_state" USING "btree" ("auth_code");


--
-- Name: idx_oauth_client_states_created_at; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX "idx_oauth_client_states_created_at" ON "auth"."oauth_client_states" USING "btree" ("created_at");


--
-- Name: idx_user_id_auth_method; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX "idx_user_id_auth_method" ON "auth"."flow_state" USING "btree" ("user_id", "authentication_method");


--
-- Name: idx_users_created_at_desc; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX "idx_users_created_at_desc" ON "auth"."users" USING "btree" ("created_at" DESC);


--
-- Name: idx_users_email; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX "idx_users_email" ON "auth"."users" USING "btree" ("email");


--
-- Name: idx_users_last_sign_in_at_desc; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX "idx_users_last_sign_in_at_desc" ON "auth"."users" USING "btree" ("last_sign_in_at" DESC);


--
-- Name: idx_users_name; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX "idx_users_name" ON "auth"."users" USING "btree" ((("raw_user_meta_data" ->> 'name'::"text"))) WHERE (("raw_user_meta_data" ->> 'name'::"text") IS NOT NULL);


--
-- Name: mfa_challenge_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX "mfa_challenge_created_at_idx" ON "auth"."mfa_challenges" USING "btree" ("created_at" DESC);


--
-- Name: mfa_factors_user_friendly_name_unique; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX "mfa_factors_user_friendly_name_unique" ON "auth"."mfa_factors" USING "btree" ("friendly_name", "user_id") WHERE (TRIM(BOTH FROM "friendly_name") <> ''::"text");


--
-- Name: mfa_factors_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX "mfa_factors_user_id_idx" ON "auth"."mfa_factors" USING "btree" ("user_id");


--
-- Name: oauth_auth_pending_exp_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX "oauth_auth_pending_exp_idx" ON "auth"."oauth_authorizations" USING "btree" ("expires_at") WHERE ("status" = 'pending'::"auth"."oauth_authorization_status");


--
-- Name: oauth_clients_deleted_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX "oauth_clients_deleted_at_idx" ON "auth"."oauth_clients" USING "btree" ("deleted_at");


--
-- Name: oauth_consents_active_client_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX "oauth_consents_active_client_idx" ON "auth"."oauth_consents" USING "btree" ("client_id") WHERE ("revoked_at" IS NULL);


--
-- Name: oauth_consents_active_user_client_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX "oauth_consents_active_user_client_idx" ON "auth"."oauth_consents" USING "btree" ("user_id", "client_id") WHERE ("revoked_at" IS NULL);


--
-- Name: oauth_consents_user_order_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX "oauth_consents_user_order_idx" ON "auth"."oauth_consents" USING "btree" ("user_id", "granted_at" DESC);


--
-- Name: one_time_tokens_relates_to_hash_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX "one_time_tokens_relates_to_hash_idx" ON "auth"."one_time_tokens" USING "hash" ("relates_to");


--
-- Name: one_time_tokens_token_hash_hash_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX "one_time_tokens_token_hash_hash_idx" ON "auth"."one_time_tokens" USING "hash" ("token_hash");


--
-- Name: one_time_tokens_user_id_token_type_key; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX "one_time_tokens_user_id_token_type_key" ON "auth"."one_time_tokens" USING "btree" ("user_id", "token_type");


--
-- Name: reauthentication_token_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX "reauthentication_token_idx" ON "auth"."users" USING "btree" ("reauthentication_token") WHERE (("reauthentication_token")::"text" !~ '^[0-9 ]*$'::"text");


--
-- Name: recovery_token_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX "recovery_token_idx" ON "auth"."users" USING "btree" ("recovery_token") WHERE (("recovery_token")::"text" !~ '^[0-9 ]*$'::"text");


--
-- Name: refresh_tokens_instance_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX "refresh_tokens_instance_id_idx" ON "auth"."refresh_tokens" USING "btree" ("instance_id");


--
-- Name: refresh_tokens_instance_id_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX "refresh_tokens_instance_id_user_id_idx" ON "auth"."refresh_tokens" USING "btree" ("instance_id", "user_id");


--
-- Name: refresh_tokens_parent_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX "refresh_tokens_parent_idx" ON "auth"."refresh_tokens" USING "btree" ("parent");


--
-- Name: refresh_tokens_session_id_revoked_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX "refresh_tokens_session_id_revoked_idx" ON "auth"."refresh_tokens" USING "btree" ("session_id", "revoked");


--
-- Name: refresh_tokens_updated_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX "refresh_tokens_updated_at_idx" ON "auth"."refresh_tokens" USING "btree" ("updated_at" DESC);


--
-- Name: saml_providers_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX "saml_providers_sso_provider_id_idx" ON "auth"."saml_providers" USING "btree" ("sso_provider_id");


--
-- Name: saml_relay_states_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX "saml_relay_states_created_at_idx" ON "auth"."saml_relay_states" USING "btree" ("created_at" DESC);


--
-- Name: saml_relay_states_for_email_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX "saml_relay_states_for_email_idx" ON "auth"."saml_relay_states" USING "btree" ("for_email");


--
-- Name: saml_relay_states_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX "saml_relay_states_sso_provider_id_idx" ON "auth"."saml_relay_states" USING "btree" ("sso_provider_id");


--
-- Name: sessions_not_after_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX "sessions_not_after_idx" ON "auth"."sessions" USING "btree" ("not_after" DESC);


--
-- Name: sessions_oauth_client_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX "sessions_oauth_client_id_idx" ON "auth"."sessions" USING "btree" ("oauth_client_id");


--
-- Name: sessions_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX "sessions_user_id_idx" ON "auth"."sessions" USING "btree" ("user_id");


--
-- Name: sso_domains_domain_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX "sso_domains_domain_idx" ON "auth"."sso_domains" USING "btree" ("lower"("domain"));


--
-- Name: sso_domains_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX "sso_domains_sso_provider_id_idx" ON "auth"."sso_domains" USING "btree" ("sso_provider_id");


--
-- Name: sso_providers_resource_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX "sso_providers_resource_id_idx" ON "auth"."sso_providers" USING "btree" ("lower"("resource_id"));


--
-- Name: sso_providers_resource_id_pattern_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX "sso_providers_resource_id_pattern_idx" ON "auth"."sso_providers" USING "btree" ("resource_id" "text_pattern_ops");


--
-- Name: unique_phone_factor_per_user; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX "unique_phone_factor_per_user" ON "auth"."mfa_factors" USING "btree" ("user_id", "phone");


--
-- Name: user_id_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX "user_id_created_at_idx" ON "auth"."sessions" USING "btree" ("user_id", "created_at");


--
-- Name: users_email_partial_key; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX "users_email_partial_key" ON "auth"."users" USING "btree" ("email") WHERE ("is_sso_user" = false);


--
-- Name: INDEX "users_email_partial_key"; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON INDEX "auth"."users_email_partial_key" IS 'Auth: A partial unique index that applies only when is_sso_user is false';


--
-- Name: users_instance_id_email_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX "users_instance_id_email_idx" ON "auth"."users" USING "btree" ("instance_id", "lower"(("email")::"text"));


--
-- Name: users_instance_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX "users_instance_id_idx" ON "auth"."users" USING "btree" ("instance_id");


--
-- Name: users_is_anonymous_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX "users_is_anonymous_idx" ON "auth"."users" USING "btree" ("is_anonymous");


--
-- Name: webauthn_challenges_expires_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX "webauthn_challenges_expires_at_idx" ON "auth"."webauthn_challenges" USING "btree" ("expires_at");


--
-- Name: webauthn_challenges_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX "webauthn_challenges_user_id_idx" ON "auth"."webauthn_challenges" USING "btree" ("user_id");


--
-- Name: webauthn_credentials_credential_id_key; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX "webauthn_credentials_credential_id_key" ON "auth"."webauthn_credentials" USING "btree" ("credential_id");


--
-- Name: webauthn_credentials_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX "webauthn_credentials_user_id_idx" ON "auth"."webauthn_credentials" USING "btree" ("user_id");


--
-- Name: ix_compound_job_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ix_compound_job_id" ON "public"."compound" USING "btree" ("job_id");


--
-- Name: ix_dockingresult_compound_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ix_dockingresult_compound_id" ON "public"."dockingresult" USING "btree" ("compound_id");


--
-- Name: ix_dockingresult_job_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ix_dockingresult_job_id" ON "public"."dockingresult" USING "btree" ("job_id");


--
-- Name: ix_dockingresult_variant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ix_dockingresult_variant" ON "public"."dockingresult" USING "btree" ("variant");


--
-- Name: ix_job_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ix_job_created_at" ON "public"."job" USING "btree" ("created_at");


--
-- Name: ix_job_pdb_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ix_job_pdb_id" ON "public"."job" USING "btree" ("pdb_id");


--
-- Name: ix_job_share_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ix_job_share_id" ON "public"."job" USING "btree" ("share_id");


--
-- Name: ix_job_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ix_job_status" ON "public"."job" USING "btree" ("status");


--
-- Name: ix_job_uniprot_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ix_job_uniprot_id" ON "public"."job" USING "btree" ("uniprot_id");


--
-- Name: ix_job_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ix_job_user_id" ON "public"."job" USING "btree" ("user_id");


--
-- Name: ix_realtime_subscription_entity; Type: INDEX; Schema: realtime; Owner: -
--

CREATE INDEX "ix_realtime_subscription_entity" ON "realtime"."subscription" USING "btree" ("entity");


--
-- Name: messages_inserted_at_topic_index; Type: INDEX; Schema: realtime; Owner: -
--

CREATE INDEX "messages_inserted_at_topic_index" ON ONLY "realtime"."messages" USING "btree" ("inserted_at" DESC, "topic") WHERE (("extension" = 'broadcast'::"text") AND ("private" IS TRUE));


--
-- Name: subscription_subscription_id_entity_filters_action_filter_key; Type: INDEX; Schema: realtime; Owner: -
--

CREATE UNIQUE INDEX "subscription_subscription_id_entity_filters_action_filter_key" ON "realtime"."subscription" USING "btree" ("subscription_id", "entity", "filters", "action_filter");


--
-- Name: bname; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX "bname" ON "storage"."buckets" USING "btree" ("name");


--
-- Name: bucketid_objname; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX "bucketid_objname" ON "storage"."objects" USING "btree" ("bucket_id", "name");


--
-- Name: buckets_analytics_unique_name_idx; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX "buckets_analytics_unique_name_idx" ON "storage"."buckets_analytics" USING "btree" ("name") WHERE ("deleted_at" IS NULL);


--
-- Name: idx_multipart_uploads_list; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX "idx_multipart_uploads_list" ON "storage"."s3_multipart_uploads" USING "btree" ("bucket_id", "key", "created_at");


--
-- Name: idx_objects_bucket_id_name; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX "idx_objects_bucket_id_name" ON "storage"."objects" USING "btree" ("bucket_id", "name" COLLATE "C");


--
-- Name: idx_objects_bucket_id_name_lower; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX "idx_objects_bucket_id_name_lower" ON "storage"."objects" USING "btree" ("bucket_id", "lower"("name") COLLATE "C");


--
-- Name: name_prefix_search; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX "name_prefix_search" ON "storage"."objects" USING "btree" ("name" "text_pattern_ops");


--
-- Name: vector_indexes_name_bucket_id_idx; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX "vector_indexes_name_bucket_id_idx" ON "storage"."vector_indexes" USING "btree" ("name", "bucket_id");


--
-- Name: subscription tr_check_filters; Type: TRIGGER; Schema: realtime; Owner: -
--

CREATE TRIGGER "tr_check_filters" BEFORE INSERT OR UPDATE ON "realtime"."subscription" FOR EACH ROW EXECUTE FUNCTION "realtime"."subscription_check_filters"();


--
-- Name: buckets enforce_bucket_name_length_trigger; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER "enforce_bucket_name_length_trigger" BEFORE INSERT OR UPDATE OF "name" ON "storage"."buckets" FOR EACH ROW EXECUTE FUNCTION "storage"."enforce_bucket_name_length"();


--
-- Name: buckets protect_buckets_delete; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER "protect_buckets_delete" BEFORE DELETE ON "storage"."buckets" FOR EACH STATEMENT EXECUTE FUNCTION "storage"."protect_delete"();


--
-- Name: objects protect_objects_delete; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER "protect_objects_delete" BEFORE DELETE ON "storage"."objects" FOR EACH STATEMENT EXECUTE FUNCTION "storage"."protect_delete"();


--
-- Name: objects update_objects_updated_at; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER "update_objects_updated_at" BEFORE UPDATE ON "storage"."objects" FOR EACH ROW EXECUTE FUNCTION "storage"."update_updated_at_column"();


--
-- Name: identities identities_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."identities"
    ADD CONSTRAINT "identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: mfa_amr_claims mfa_amr_claims_session_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."mfa_amr_claims"
    ADD CONSTRAINT "mfa_amr_claims_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "auth"."sessions"("id") ON DELETE CASCADE;


--
-- Name: mfa_challenges mfa_challenges_auth_factor_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."mfa_challenges"
    ADD CONSTRAINT "mfa_challenges_auth_factor_id_fkey" FOREIGN KEY ("factor_id") REFERENCES "auth"."mfa_factors"("id") ON DELETE CASCADE;


--
-- Name: mfa_factors mfa_factors_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."mfa_factors"
    ADD CONSTRAINT "mfa_factors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: oauth_authorizations oauth_authorizations_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."oauth_authorizations"
    ADD CONSTRAINT "oauth_authorizations_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "auth"."oauth_clients"("id") ON DELETE CASCADE;


--
-- Name: oauth_authorizations oauth_authorizations_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."oauth_authorizations"
    ADD CONSTRAINT "oauth_authorizations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: oauth_consents oauth_consents_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."oauth_consents"
    ADD CONSTRAINT "oauth_consents_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "auth"."oauth_clients"("id") ON DELETE CASCADE;


--
-- Name: oauth_consents oauth_consents_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."oauth_consents"
    ADD CONSTRAINT "oauth_consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: one_time_tokens one_time_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."one_time_tokens"
    ADD CONSTRAINT "one_time_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: refresh_tokens refresh_tokens_session_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."refresh_tokens"
    ADD CONSTRAINT "refresh_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "auth"."sessions"("id") ON DELETE CASCADE;


--
-- Name: saml_providers saml_providers_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."saml_providers"
    ADD CONSTRAINT "saml_providers_sso_provider_id_fkey" FOREIGN KEY ("sso_provider_id") REFERENCES "auth"."sso_providers"("id") ON DELETE CASCADE;


--
-- Name: saml_relay_states saml_relay_states_flow_state_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."saml_relay_states"
    ADD CONSTRAINT "saml_relay_states_flow_state_id_fkey" FOREIGN KEY ("flow_state_id") REFERENCES "auth"."flow_state"("id") ON DELETE CASCADE;


--
-- Name: saml_relay_states saml_relay_states_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."saml_relay_states"
    ADD CONSTRAINT "saml_relay_states_sso_provider_id_fkey" FOREIGN KEY ("sso_provider_id") REFERENCES "auth"."sso_providers"("id") ON DELETE CASCADE;


--
-- Name: sessions sessions_oauth_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."sessions"
    ADD CONSTRAINT "sessions_oauth_client_id_fkey" FOREIGN KEY ("oauth_client_id") REFERENCES "auth"."oauth_clients"("id") ON DELETE CASCADE;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."sessions"
    ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: sso_domains sso_domains_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."sso_domains"
    ADD CONSTRAINT "sso_domains_sso_provider_id_fkey" FOREIGN KEY ("sso_provider_id") REFERENCES "auth"."sso_providers"("id") ON DELETE CASCADE;


--
-- Name: webauthn_challenges webauthn_challenges_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."webauthn_challenges"
    ADD CONSTRAINT "webauthn_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: webauthn_credentials webauthn_credentials_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY "auth"."webauthn_credentials"
    ADD CONSTRAINT "webauthn_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: compound compound_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."compound"
    ADD CONSTRAINT "compound_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id");


--
-- Name: dockingresult dockingresult_compound_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."dockingresult"
    ADD CONSTRAINT "dockingresult_compound_id_fkey" FOREIGN KEY ("compound_id") REFERENCES "public"."compound"("id");


--
-- Name: dockingresult dockingresult_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."dockingresult"
    ADD CONSTRAINT "dockingresult_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id");


--
-- Name: objects objects_bucketId_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY "storage"."objects"
    ADD CONSTRAINT "objects_bucketId_fkey" FOREIGN KEY ("bucket_id") REFERENCES "storage"."buckets"("id");


--
-- Name: s3_multipart_uploads s3_multipart_uploads_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY "storage"."s3_multipart_uploads"
    ADD CONSTRAINT "s3_multipart_uploads_bucket_id_fkey" FOREIGN KEY ("bucket_id") REFERENCES "storage"."buckets"("id");


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY "storage"."s3_multipart_uploads_parts"
    ADD CONSTRAINT "s3_multipart_uploads_parts_bucket_id_fkey" FOREIGN KEY ("bucket_id") REFERENCES "storage"."buckets"("id");


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_upload_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY "storage"."s3_multipart_uploads_parts"
    ADD CONSTRAINT "s3_multipart_uploads_parts_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "storage"."s3_multipart_uploads"("id") ON DELETE CASCADE;


--
-- Name: vector_indexes vector_indexes_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY "storage"."vector_indexes"
    ADD CONSTRAINT "vector_indexes_bucket_id_fkey" FOREIGN KEY ("bucket_id") REFERENCES "storage"."buckets_vectors"("id");


--
-- Name: audit_log_entries; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE "auth"."audit_log_entries" ENABLE ROW LEVEL SECURITY;

--
-- Name: flow_state; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE "auth"."flow_state" ENABLE ROW LEVEL SECURITY;

--
-- Name: identities; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE "auth"."identities" ENABLE ROW LEVEL SECURITY;

--
-- Name: instances; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE "auth"."instances" ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_amr_claims; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE "auth"."mfa_amr_claims" ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_challenges; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE "auth"."mfa_challenges" ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_factors; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE "auth"."mfa_factors" ENABLE ROW LEVEL SECURITY;

--
-- Name: one_time_tokens; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE "auth"."one_time_tokens" ENABLE ROW LEVEL SECURITY;

--
-- Name: refresh_tokens; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE "auth"."refresh_tokens" ENABLE ROW LEVEL SECURITY;

--
-- Name: saml_providers; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE "auth"."saml_providers" ENABLE ROW LEVEL SECURITY;

--
-- Name: saml_relay_states; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE "auth"."saml_relay_states" ENABLE ROW LEVEL SECURITY;

--
-- Name: schema_migrations; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE "auth"."schema_migrations" ENABLE ROW LEVEL SECURITY;

--
-- Name: sessions; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE "auth"."sessions" ENABLE ROW LEVEL SECURITY;

--
-- Name: sso_domains; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE "auth"."sso_domains" ENABLE ROW LEVEL SECURITY;

--
-- Name: sso_providers; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE "auth"."sso_providers" ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE "auth"."users" ENABLE ROW LEVEL SECURITY;

--
-- Name: messages; Type: ROW SECURITY; Schema: realtime; Owner: -
--

ALTER TABLE "realtime"."messages" ENABLE ROW LEVEL SECURITY;

--
-- Name: buckets; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE "storage"."buckets" ENABLE ROW LEVEL SECURITY;

--
-- Name: buckets_analytics; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE "storage"."buckets_analytics" ENABLE ROW LEVEL SECURITY;

--
-- Name: buckets_vectors; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE "storage"."buckets_vectors" ENABLE ROW LEVEL SECURITY;

--
-- Name: migrations; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE "storage"."migrations" ENABLE ROW LEVEL SECURITY;

--
-- Name: objects; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE "storage"."objects" ENABLE ROW LEVEL SECURITY;

--
-- Name: s3_multipart_uploads; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE "storage"."s3_multipart_uploads" ENABLE ROW LEVEL SECURITY;

--
-- Name: s3_multipart_uploads_parts; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE "storage"."s3_multipart_uploads_parts" ENABLE ROW LEVEL SECURITY;

--
-- Name: vector_indexes; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE "storage"."vector_indexes" ENABLE ROW LEVEL SECURITY;

--
-- Name: supabase_realtime; Type: PUBLICATION; Schema: -; Owner: -
--

CREATE PUBLICATION "supabase_realtime" WITH (publish = 'insert, update, delete, truncate');


--
-- Name: issue_graphql_placeholder; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER "issue_graphql_placeholder" ON "sql_drop"
         WHEN TAG IN ('DROP EXTENSION')
   EXECUTE FUNCTION "extensions"."set_graphql_placeholder"();


--
-- Name: issue_pg_cron_access; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER "issue_pg_cron_access" ON "ddl_command_end"
         WHEN TAG IN ('CREATE EXTENSION')
   EXECUTE FUNCTION "extensions"."grant_pg_cron_access"();


--
-- Name: issue_pg_graphql_access; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER "issue_pg_graphql_access" ON "ddl_command_end"
         WHEN TAG IN ('CREATE EXTENSION')
   EXECUTE FUNCTION "extensions"."grant_pg_graphql_access"();


--
-- Name: issue_pg_net_access; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER "issue_pg_net_access" ON "ddl_command_end"
         WHEN TAG IN ('CREATE EXTENSION')
   EXECUTE FUNCTION "extensions"."grant_pg_net_access"();


--
-- Name: pgrst_ddl_watch; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER "pgrst_ddl_watch" ON "ddl_command_end"
   EXECUTE FUNCTION "extensions"."pgrst_ddl_watch"();


--
-- Name: pgrst_drop_watch; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER "pgrst_drop_watch" ON "sql_drop"
   EXECUTE FUNCTION "extensions"."pgrst_drop_watch"();


--
-- PostgreSQL database dump complete
--

\unrestrict 89j0gKbV6k9nBLS4LVbIQ1IxnOmacSJXFrhJKpcVHFbBAjVod6hFnQTqr2TeLsY

