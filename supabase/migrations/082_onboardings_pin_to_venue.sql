-- Pin existing onboardings to the venue they are actually for.
--
-- 26 of 27 had no location_id, so every screen fell back to the company. For a
-- partner company with two dozen venues that is worse than useless: the record
-- said "Lightspeed Netherlands" when the install was one pub in Sheffield.
--
-- The deal already knew. Each onboarding's deal carries the venue as an
-- affected_location association, and all 26 resolve from it with nothing
-- ambiguous, so this is recovering information we already held rather than
-- guessing. Only NULLs are touched: a location set by hand always wins.
update public.onboardings o
   set location_id = d.loc, updated_at = now()
  from (
    select o2.id,
           (select case when a.from_type = 'location' then a.from_id else a.to_id end
              from public.associations a
             where (a.from_type = 'deal' and a.from_id = o2.deal_id and a.to_type = 'location')
                or (a.to_type   = 'deal' and a.to_id   = o2.deal_id and a.from_type = 'location')
             limit 1) as loc
      from public.onboardings o2
     where o2.location_id is null and o2.deal_id is not null
  ) d
 where o.id = d.id and d.loc is not null;

-- Second pass: a company with exactly one venue has no ambiguity either.
update public.onboardings o
   set location_id = v.id, updated_at = now()
  from public.locations v
 where o.location_id is null
   and v.company_id = o.company_id
   and (select count(*) from public.locations l where l.company_id = o.company_id) = 1;
