-- migration_041: só admin muda papel/aprovação de um perfil + marca de conta de teste.
--
-- FALHA CORRIGIDA (2026-10-22): a policy profiles_update_own_or_admin deixa cada
-- usuário atualizar a PRÓPRIA linha inteira, e authenticated tinha UPDATE em todas
-- as colunas. Qualquer pessoa que se cadastrasse podia, pela API, se aprovar
-- (status='aprovado') e virar admin (role='admin'). Testado e confirmado antes
-- da correção.
--
-- A correção mantém o que o revendedor precisa (editar nome, empresa, telefone e
-- cidade no painel dele) e trava, pra quem não é admin, as colunas de controle:
-- id, role, status, created_at e conta_teste.

alter table public.profiles add column if not exists conta_teste boolean not null default false;

create or replace function public.profiles_protege_controle()
returns trigger
language plpgsql
-- security INVOKER de propósito: current_user precisa ser quem fez o update
-- (authenticated), não o dono da função. is_admin() já é definer por conta própria.
set search_path to 'public'
as $$
begin
  -- service_role (Edge Functions) e o próprio banco passam; usuário comum, só se for admin.
  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
     or current_user in ('postgres', 'supabase_admin', 'supabase_auth_admin') then
    return new;
  end if;
  if public.is_admin() then
    return new;
  end if;
  if new.id is distinct from old.id
     or new.role is distinct from old.role
     or new.status is distinct from old.status
     or new.created_at is distinct from old.created_at
     or new.conta_teste is distinct from old.conta_teste then
    raise exception 'Só um administrador pode mudar acesso ou aprovação' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.profiles_protege_controle() from public, anon, authenticated;

drop trigger if exists profiles_protege_controle on public.profiles;
create trigger profiles_protege_controle
  before update on public.profiles
  for each row execute function public.profiles_protege_controle();

-- Conta usada nos testes do painel do revendedor: some das listas do admin.
update public.profiles set conta_teste = true where email = 'revendedor-teste@dupuroacai.com';
