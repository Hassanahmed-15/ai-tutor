import { isProgrammingTopic } from "../codeSpec";
import { isMathsTopic } from "./predictCard";

/** Computer-science topics that are not programming as such: number systems, logic, algorithms, hardware. */
const COMPUTING = /\b(computer science|computing|algorithms?|pseudo-?code|flow ?charts?|binary (numbers?|search|trees?|addition)|hexadecimal|denary|two'?s complement|logic gates?|boolean (logic|algebra|expressions?)|truth tables?|cpu|fetch[- ]decode[- ]execute|von neumann|dijkstra|breadth[- ]first|depth[- ]first|bfs|dfs|avl trees?|bst|heaps? sort|stacks? and queues|computational thinking|abstraction and decomposition|big ?o)\b/i;

/**
 * Is this lecture taught the Visuals Lab's way (owner, 2026-10-20) — maths or computer science?
 * Those lectures get the marker that writes the board and chalk-drawn cards; others keep their look.
 */
export function isLabLookTopic(topic: string | undefined | null): boolean {
  const t = topic ?? "";
  return isMathsTopic(t) || isProgrammingTopic(t) || COMPUTING.test(t);
}

/** A computer-science lecture (programming, algorithms, data structures, computing) — not a maths one. */
export function isCsTopic(topic: string | undefined | null): boolean {
  const t = topic ?? "";
  // A named language is programming ("Python functions" is not the maths of functions); a science
  // practical's "variables in an experiment" is not.
  if (LANGUAGE.test(t) || STRONG_CS.test(t)) return true;
  if (isMathsTopic(t)) return false;
  if (/\b(experiments?|investigations?|practicals?)\b/i.test(t) && !COMPUTING.test(t)) return false;
  return isProgrammingTopic(t) || COMPUTING.test(t) || DATA_STRUCTURES.test(t);
}

// Words only computer science uses: they make a lecture CS even beside a maths word — "balanced brackets
// with a stack" and "permutations with backtracking" were taught by the maths rules (CS round 4), and
// "selection sort" and "tree traversals" by no CS rule at all.
const STRONG_CS = /\b(?:stacks?|queues?|linked lists?|hash (?:tables?|maps?)|heaps?|tries|trie|binary (?:search )?trees?|bsts?|traversals?|in-order|pre-order|post-order|(?:selection|insertion|bubble|merge|quick|heap|counting|radix|shell)[- ]?sort|sorting(?: algorithms?)?|backtracking|recursion|recursive (?:functions?|calls?|algorithms?)|two[- ]pointers?|sliding window|bit manipulation|bitwise|dynamic programming|memoi[sz]ation|greedy algorithms?|big ?o|time complexity|bfs|dfs|breadth[- ]first|depth[- ]first|dijkstra|pseudo-?code|data structures?)\b/i;

const LANGUAGE = /\b(python|javascript|typescript|java|kotlin|swift|rust|golang|ruby|php|sql|pseudo-?code)\b|c\+\+|c#/i;

const DATA_STRUCTURES = /\b(linked lists?|stacks?|queues?|hash (tables?|maps?)|binary trees?|heaps?|graphs? traversal|sorting algorithms?|recursion|recursive|data structures?|big ?o|time complexity|(?:for|while) loops?|loops? in (?:python|java|c|javascript)|arrays? in (?:python|java|c|javascript)|(?:python|java|javascript) (?:functions?|variables?|arrays?|lists?|loops?|classes)|lists? in python|object[- ]oriented|classes and objects)\b/i;
