class_name TurnManager
extends RefCounted

## Controle de vez. Brancas começam; a vez alterna a cada jogada válida.
## Guarda também o histórico (base para undo, notação e detecção de empate
## por repetição mais tarde).

signal turn_changed(is_white: bool)

var is_white_turn := true
var full_moves := 1
var is_finished := false
var history: Array[Dictionary] = []


func reset() -> void:
	is_white_turn = true
	full_moves = 1
	is_finished = false
	history.clear()
	turn_changed.emit(is_white_turn)


## Única porta de entrada para "posso mexer nesta peça?".
func can_move(piece_is_white: bool) -> bool:
	return piece_is_white == is_white_turn


## Chamar ANTES de end_turn(), enquanto is_white_turn ainda é quem jogou.
func record(from: Vector2i, to: Vector2i, piece: Piece, captured: Piece) -> void:
	history.append({
		"move": full_moves,
		"white": is_white_turn,
		"from": from,
		"to": to,
		"type": piece.type if piece != null else -1,
		"captured_type": captured.type if captured != null else -1,
	})


## Trava o tabuleiro em xeque-mate ou afogamento.
func finish() -> void:
	is_finished = true


func end_turn() -> void:
	if is_finished:
		return
	if not is_white_turn:
		full_moves += 1
	is_white_turn = not is_white_turn
	turn_changed.emit(is_white_turn)


## Notação curta o suficiente para debug sem implementar SAN completo.
func last_move_notation() -> String:
	if history.is_empty():
		return ""
	var entry := history.back()
	var text: String = ("%d. " % entry["move"]) if entry["white"] else ("%d... " % entry["move"])
	text += ChessRules.algebraic(entry["from"]) + "->" + ChessRules.algebraic(entry["to"])
	if entry["captured_type"] != -1:
		text += " x"
	return text
