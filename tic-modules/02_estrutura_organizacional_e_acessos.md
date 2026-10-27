# Módulo 02 — Estrutura Organizacional e Acessos

## 1. Objetivo

Controlar usuários, departamentos e o escopo de visualização dos perfis Gerente e Diretor.

## 2. Dependências

- Módulo 01.

## 3. Modelo organizacional

Não haverá hierarquia rígida obrigatória entre gerente e diretor.

A estrutura operacional será baseada em associações de acesso:

- um usuário pode visualizar vários departamentos;
- um departamento pode ser visualizado por vários gerentes;
- um departamento pode ser visualizado por vários diretores;
- um projeto pode atender vários departamentos.

## 4. Entidades

### User

- id;
- nome;
- e-mail;
- perfil;
- status;
- campos de autenticação.

### Department

- id;
- código;
- nome;
- status.

### UserDepartmentScope

- userId;
- departmentId;
- tipo de vínculo opcional;
- data de criação.

## 5. Perfis

### Administrador

Acesso total.

### Gerente de Projetos

Acesso operacional equivalente ao administrador para regras e dados de projeto.

Diferenças administrativas poderão existir apenas para gestão sensível de usuários ou infraestrutura, sem limitar o trabalho de projeto.

### Gerente

- somente leitura;
- visualiza projetos associados a qualquer departamento do seu escopo;
- visualiza todos os dados do projeto permitido;
- pode exportar relatórios autorizados;
- não altera projetos.

### Diretor

- somente leitura;
- visualiza os departamentos do seu escopo;
- pode filtrar por departamento;
- vê informações financeiras dos projetos permitidos.

## 6. Regra de projeto com vários departamentos

Se um projeto estiver relacionado aos departamentos A e B:

- usuário com acesso ao A visualiza o projeto;
- usuário com acesso ao B visualiza o projeto;
- o projeto é exibido integralmente.

## 7. Regras de API

O escopo deve ser aplicado no backend.

Nunca confiar apenas em filtros de frontend.

Toda consulta de projeto para gerente ou diretor deve aplicar:

```text
project.departments intersects user.allowedDepartments
```

## 8. Telas

- usuários;
- criar usuário;
- editar usuário;
- departamentos;
- associação de departamentos ao usuário;
- visualização do próprio perfil.

## 9. APIs sugeridas

- `GET /users`;
- `POST /users`;
- `GET /users/:id`;
- `PATCH /users/:id`;
- `POST /users/:id/activate`;
- `POST /users/:id/deactivate`;
- `PUT /users/:id/departments`;
- `GET /departments`;
- `POST /departments`;
- `PATCH /departments/:id`;
- `POST /departments/:id/activate`;
- `POST /departments/:id/deactivate`.

## 10. Validações

- e-mail único;
- usuário Gerente ou Diretor deve ter ao menos um departamento para acessar dados;
- usuário inativo não acessa;
- departamento referenciado não pode ser removido fisicamente;
- administrador e gerente de projetos não precisam de escopo departamental.

## 11. Critérios de aceite

- gerente vê somente projetos de seus departamentos;
- diretor vê somente projetos de seus departamentos;
- projeto multidepartamental aparece para todos os usuários autorizados;
- escrita bloqueada para gerente e diretor;
- mudança de escopo produz efeito imediato;
- testes de autorização cobrem acesso permitido e negado.
