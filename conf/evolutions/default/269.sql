-- --- !Ups
create schema if not exists sidewalk_login;

create table sidewalk_login.global_user_stats (
    user_id              uuid primary key
        references sidewalk_login.user_account(user_id) on delete cascade,
    tutorial_completed   boolean      not null default false,
    tutorial_completed_at timestamptz
);

-- back‑fill: everyone who ever *finished* an auditOnboarding mission in any city
insert into sidewalk_login.global_user_stats (user_id, tutorial_completed, tutorial_completed_at)
select  m.user_id,
        true,
        max(m.mission_end)
from    mission m
join    mission_type mt on mt.mission_type_id = m.mission_type_id
where   mt.mission_type = 'auditOnboarding'
  and   m.completed
group by m.user_id
on conflict (user_id) do nothing;

-- minimal privileges so every city app role can read / write its own row
grant select, update on sidewalk_login.global_user_stats
      to "sidewalk_role_readwrite";

-- --- !Downs
drop table if exists sidewalk_login.global_user_stats;
