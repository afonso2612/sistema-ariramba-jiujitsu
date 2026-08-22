import { supabase, supabaseConfigurado } from "../lib/supabaseClient";
import {
  alunoDoBanco,
  alunoParaBanco,
  presencaDoBanco,
  presencaParaBanco,
} from "./supabaseMappers";

function exigirSupabase() {
  if (!supabaseConfigurado || !supabase) {
    throw new Error("Supabase ainda não configurado.");
  }
}

function idSupabaseValido(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(id || "")
  );
}

function detalharErroSupabase(error) {
  return [error?.message, error?.details, error?.hint, error?.code]
    .filter(Boolean)
    .join(" | ");
}

const COLUNAS_ALUNO_LISTA = [
  "id",
  "nome",
  "telefone",
  "faixa",
  "turma",
  "grau",
  "responsavel",
  "data_nascimento",
  "data_inicio",
  "peso",
  "mensalidade",
  "vencimento",
  "status_pagamento",
  "ultimo_pagamento",
  "tipo_sanguineo",
  "saude",
  "medicamentos",
  "observacoes",
  "observacao_financeira",
  "foto_url",
].join(",");

const COLUNAS_ALUNO_LISTA_SEM_AUTH = COLUNAS_ALUNO_LISTA
  .split(",")
  .filter((coluna) => coluna !== "auth_user_id")
  .join(",");

function erroColunaInexistente(error, coluna) {
  return (
    ["42703", "PGRST204"].includes(error?.code) &&
    String(error.message || "").includes(coluna)
  );
}

function colunaTurmaNaoExiste(error) {
  return erroColunaInexistente(error, "turma");
}

async function obterAcademiaAtual() {
  const { data: sessao, error: erroSessao } = await supabase.auth.getSession();

  if (erroSessao) throw erroSessao;

  const userId = sessao.session?.user?.id;

  if (!userId) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("academia_id")
    .eq("id", userId)
    .single();

  if (erroColunaInexistente(error, "academia_id")) return null;
  if (error) throw error;
  return data?.academia_id || null;
}

export async function listarAlunosOnline() {
  exigirSupabase();

  let { data, error } = await supabase
    .from("alunos")
    .select(COLUNAS_ALUNO_LISTA)
    .order("nome", { ascending: true });

  if (erroColunaInexistente(error, "auth_user_id")) {
    ({ data, error } = await supabase
      .from("alunos")
      .select(COLUNAS_ALUNO_LISTA_SEM_AUTH)
      .order("nome", { ascending: true }));
  }

  if (colunaTurmaNaoExiste(error)) {
    const colunasSemTurma = COLUNAS_ALUNO_LISTA_SEM_AUTH
      .split(",")
      .filter((coluna) => coluna !== "turma")
      .join(",");

    ({ data, error } = await supabase
      .from("alunos")
      .select(colunasSemTurma)
      .order("nome", { ascending: true }));
  }

  if (error) throw new Error(detalharErroSupabase(error) || "Erro ao listar alunos online.");
  return data.map(alunoDoBanco);
}

export async function salvarAlunoOnline(aluno) {
  exigirSupabase();

  const linhaAluno = alunoParaBanco(aluno);
  linhaAluno.academia_id = linhaAluno.academia_id || (await obterAcademiaAtual()) || undefined;

  const salvarLinha = async (linha) =>
    supabase
      .from("alunos")
      .upsert(linha, { onConflict: "id" })
      .select()
      .single();

  let { data, error } = await salvarLinha(linhaAluno);

  if (erroColunaInexistente(error, "academia_id")) {
    delete linhaAluno.academia_id;
    ({ data, error } = await salvarLinha(linhaAluno));
  }

  if (erroColunaInexistente(error, "auth_user_id")) {
    delete linhaAluno.auth_user_id;
    ({ data, error } = await salvarLinha(linhaAluno));
  }

  if (colunaTurmaNaoExiste(error)) {
    delete linhaAluno.turma;
    ({ data, error } = await salvarLinha(linhaAluno));
  }

  if (error) {
    throw new Error(detalharErroSupabase(error) || "Erro desconhecido ao salvar aluno.");
  }

  if (!data?.id) {
    throw new Error("O banco nao retornou o ID do aluno salvo.");
  }

  const { data: confirmado, error: erroConfirmacao } = await supabase
    .from("alunos")
    .select(COLUNAS_ALUNO_LISTA_SEM_AUTH.replace(",turma", ""))
    .eq("id", data.id)
    .single();

  if (erroConfirmacao) {
    throw new Error(
      `Aluno enviado, mas nao foi possivel confirmar a leitura no banco: ${
        detalharErroSupabase(erroConfirmacao) || "erro desconhecido"
      }`
    );
  }

  return alunoDoBanco({
    ...confirmado,
    turma: confirmado.turma || data.turma || aluno.turma || "Adultos",
  });
}

export async function obterAlunoOnline(id) {
  exigirSupabase();

  const { data, error } = await supabase
    .from("alunos")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  return alunoDoBanco(data);
}

export async function obterFotoAlunoOnline(id) {
  exigirSupabase();

  const { data, error } = await supabase
    .from("alunos")
    .select("foto_url")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data?.foto_url || "";
}

export async function buscarUsuarioSistemaOnline(usuario) {
  exigirSupabase();

  const { data, error } = await supabase
    .from("usuarios_sistema")
    .select("*")
    .ilike("usuario", usuario)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    id: data.id,
    usuario: data.usuario,
    senha: data.senha,
    cargo: data.cargo,
    nome: data.nome,
    alunoId: data.aluno_id,
    academiaId: data.academia_id,
    fotoUrl: data.foto_url || "",
    origem: "usuarios_sistema",
  };
}

export async function buscarUsuarioSistemaOnlinePorAluno(idAluno) {
  exigirSupabase();

  const { data, error } = await supabase
    .from("usuarios_sistema")
    .select("*")
    .eq("aluno_id", idAluno)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    id: data.id,
    usuario: data.usuario,
    senha: data.senha,
    cargo: data.cargo,
    nome: data.nome,
    alunoId: data.aluno_id,
    academiaId: data.academia_id,
    fotoUrl: data.foto_url || "",
    origem: "usuarios_sistema",
  };
}

export async function salvarUsuarioSistemaOnline(usuario) {
  exigirSupabase();

  const linha = {
    usuario: usuario.usuario,
    senha: String(usuario.senha),
    cargo: usuario.cargo,
    nome: usuario.nome,
    aluno_id: usuario.alunoId || null,
    academia_id: usuario.academiaId || null,
    foto_url: usuario.fotoUrl || usuario.foto_url || null,
  };

  linha.academia_id = linha.academia_id || (await obterAcademiaAtual()) || undefined;

  if (idSupabaseValido(usuario.id)) {
    let { data, error } = await supabase
      .from("usuarios_sistema")
      .update(linha)
      .eq("id", usuario.id)
      .select()
      .maybeSingle();

    if (erroColunaInexistente(error, "academia_id")) {
      delete linha.academia_id;
      ({ data, error } = await supabase
        .from("usuarios_sistema")
        .update(linha)
        .eq("id", usuario.id)
        .select()
        .maybeSingle());
    }

    if (erroColunaInexistente(error, "foto_url")) {
      delete linha.foto_url;
      ({ data, error } = await supabase
        .from("usuarios_sistema")
        .update(linha)
        .eq("id", usuario.id)
        .select()
        .maybeSingle());
    }

    if (error) throw error;
    if (data) return data;
  }

  const { data: existente, error: erroBusca } = await supabase
    .from("usuarios_sistema")
    .select("id,aluno_id,cargo")
    .ilike("usuario", usuario.usuario)
    .maybeSingle();

  if (erroBusca) throw erroBusca;

  if (existente) {
    const mesmoId = usuario.id && String(existente.id) === String(usuario.id);
    const mesmoAluno =
      usuario.alunoId &&
      existente.aluno_id &&
      String(existente.aluno_id) === String(usuario.alunoId);

    if (!mesmoId && !mesmoAluno) {
      throw new Error("Este usuario ja existe no banco online. Escolha outro usuario.");
    }
  }

  async function salvarLinhaUsuario(linhaUsuario) {
    if (existente) {
      return supabase
        .from("usuarios_sistema")
        .update(linhaUsuario)
        .eq("id", existente.id)
        .select()
        .single();
    }

    return supabase
      .from("usuarios_sistema")
      .insert(linhaUsuario)
      .select()
      .single();
  }

  let { data, error } = await salvarLinhaUsuario(linha);

  if (erroColunaInexistente(error, "academia_id")) {
    delete linha.academia_id;
    ({ data, error } = await salvarLinhaUsuario(linha));
  }

  if (erroColunaInexistente(error, "foto_url")) {
    delete linha.foto_url;
    ({ data, error } = await salvarLinhaUsuario(linha));
  }

  if (error) throw error;
  return data;
}

export async function removerUsuarioSistemaOnlinePorAluno(idAluno) {
  exigirSupabase();

  const { error } = await supabase
    .from("usuarios_sistema")
    .delete()
    .eq("aluno_id", idAluno);

  if (error) throw error;
}

export async function removerAlunoOnline(id) {
  exigirSupabase();

  const { error } = await supabase.from("alunos").delete().eq("id", id);

  if (error) throw error;
}

export async function listarPresencasOnline() {
  exigirSupabase();

  const { data, error } = await supabase
    .from("presencas")
    .select("id,aluno_id,data,hora,criado_em")
    .order("criado_em", { ascending: false });

  if (error) throw error;
  return data.map(presencaDoBanco);
}

export async function listarPagamentosOnline() {
  exigirSupabase();

  const { data, error } = await supabase
    .from("pagamentos")
    .select("*")
    .order("criado_em", { ascending: false });

  if (error) throw error;
  return data;
}

export async function registrarPresencaOnline(presenca) {
  exigirSupabase();

  const { data, error } = await supabase
    .from("presencas")
    .insert(presencaParaBanco(presenca))
    .select()
    .single();

  if (error) throw error;
  return presencaDoBanco(data);
}

export async function migrarAlunosOnline(alunos) {
  exigirSupabase();

  const academiaId = await obterAcademiaAtual();

  const alunosMigrados = [];

  for (const aluno of alunos) {
    const linha = alunoParaBanco(aluno);
    linha.academia_id = linha.academia_id || academiaId || undefined;

    if (!idSupabaseValido(linha.id)) {
      delete linha.id;

      let consultaExistente = supabase
        .from("alunos")
        .select("id,nome")
        .ilike("nome", linha.nome);

      if (linha.academia_id) {
        consultaExistente = consultaExistente.eq("academia_id", linha.academia_id);
      }

      let { data: existente, error: erroBusca } = await consultaExistente.maybeSingle();

      if (erroColunaInexistente(erroBusca, "academia_id")) {
        delete linha.academia_id;
        ({ data: existente, error: erroBusca } = await supabase
          .from("alunos")
          .select("id,nome")
          .ilike("nome", linha.nome)
          .maybeSingle());
      }

      if (erroBusca) {
        throw new Error(detalharErroSupabase(erroBusca) || "Erro ao buscar aluno existente.");
      }

      if (existente?.id) {
        linha.id = existente.id;
      }
    }

    alunosMigrados.push(await salvarAlunoOnline(linha));
  }

  return alunosMigrados;
}

export async function salvarPagamentoOnline(pagamento) {
  exigirSupabase();

  const { data, error } = await supabase
    .from("pagamentos")
    .upsert(pagamento)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function enviarArquivoOnline(bucket, caminho, arquivo) {
  exigirSupabase();

  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(caminho, arquivo, { upsert: true });

  if (error) throw error;
  return data;
}
